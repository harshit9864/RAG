import os
from typing import List
from dotenv import load_dotenv

import pdfplumber 
from pydantic import BaseModel, Field
from langchain_fireworks import ChatFireworks
from langchain_mistralai import MistralAIEmbeddings

# 1. MongoDB Imports
from pymongo import MongoClient
from langchain_mongodb import MongoDBAtlasVectorSearch
from langchain_community.storage import MongoDBByteStore  # <--- NEW IMPORT
from langchain_classic.storage import EncoderBackedStore
from langchain_classic.load import dumps, loads

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_classic.retrievers import ParentDocumentRetriever
from langchain_classic.retrievers import MultiQueryRetriever
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document

load_dotenv()

# --- CONFIGURATION ---
LLM_MODEL = "accounts/fireworks/models/kimi-k2-instruct-0905"
EMBEDDING_MODEL = "mistral-embed"

# --- DATA MODELS ---
class GradeAnswerQuality(BaseModel):
    binary_score: str = Field(description="Answer addresses the question, 'yes' or 'no'")

class VeriDocEngine:
    def __init__(self):
        # 1. Setup LLM
        self.llm = ChatFireworks(
            model=LLM_MODEL,
            temperature=0,
            max_retries=2,
        )
        
        # 2. Setup Embeddings
        self.embeddings = MistralAIEmbeddings(
            model=EMBEDDING_MODEL,
            api_key=os.getenv("MISTRAL_API_KEY")
        )
        
        # 3. Setup MongoDB Connection
        mongo_uri = os.getenv("MONGODB_ATLAS_URI")
        if not mongo_uri:
            raise ValueError("MONGODB_ATLAS_URI not found in environment variables")
            
        self.mongo_client = MongoClient(mongo_uri)
        self.db_name = "financial_db"
        self.collection = self.mongo_client[self.db_name]["reports"]
        
        # 4. Initialize MongoDB Atlas Vector Store (For Child Chunks)
        self.vectorstore = MongoDBAtlasVectorSearch(
            collection=self.collection,
            embedding=self.embeddings,
            index_name="vector_index",
            relevance_score_fn="cosine" 
        )

        # 5. FIXED: Persistent DocStore (Parent Documents)
        # We define the raw byte storage
        raw_store = MongoDBByteStore(
            connection_string=mongo_uri,
            db_name=self.db_name,
            collection_name="parent_docs"
        )
        
        # We wrap it with an Encoder to handle Document objects
        self.docstore = EncoderBackedStore(
            store=raw_store,
            key_encoder=lambda x: x,
            value_serializer=lambda doc: dumps(doc).encode('utf-8'),
            value_deserializer=lambda bytes: loads(bytes.decode('utf-8'))
        )
        
        self.base_retriever = None
        self.multi_query_retriever = None
        
        self.chains = self._build_chains()

    def _build_chains(self):
        # ... (Same as before) ...
        gen_prompt = ChatPromptTemplate.from_template(
            """You are a financial analyst assistant. Answer based ONLY on the context provided.

IMPORTANT INSTRUCTIONS:
- If the context contains tables or structured data, analyze them carefully
- For numerical questions, extract exact values and perform calculations if needed
- For date-based queries, pay attention to fiscal years and calendar years
- If you need to sum or calculate values, show your work
- If the answer is not in the context, say "I cannot find this information in the provided context"

Context: {context}

Question: {question}

Answer:"""
        )
        rag_chain = gen_prompt | self.llm | StrOutputParser()

        quality_llm = self.llm.with_structured_output(GradeAnswerQuality)
        quality_grader = (
            ChatPromptTemplate.from_template(
                """Check if the answer addresses the question. 
                Question: {question}
                Answer: {generation}
                If it says "I don't know" or is vague, score it 'no'.
                """
            ) | quality_llm
        )

        return {"rag": rag_chain, "quality": quality_grader}

    def _load_pdf_with_layout(self, file_path: str) -> List[Document]:
        # ... (Same as before) ...
        print(f"... Ingesting {file_path} with Layout Preservation ...")
        documents = []
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text(x_tolerance=1, y_tolerance=3)
                tables = page.extract_tables()
                
                page_content = text if text else ""
                
                if tables:
                    page_content += "\n\n=== TABLES ON THIS PAGE ===\n"
                    for table_idx, table in enumerate(tables):
                        page_content += f"\n--- Table {table_idx + 1} ---\n"
                        clean_rows = [[str(cell) if cell else "" for cell in row] for row in table]
                        for row in clean_rows:
                            page_content += " | ".join(row) + " |\n"
                
                if page_content.strip():
                    documents.append(Document(
                        page_content=page_content, 
                        metadata={"page": i+1, "source": file_path}
                    ))
        
        print(f"... Loaded {len(documents)} pages")
        return documents

    def ingest_document(self, file_path: str):
        print(f"\n--- 1. Ingesting Document: {file_path} ---")
        
        docs = self._load_pdf_with_layout(file_path)
        
        parent_splitter = RecursiveCharacterTextSplitter(chunk_size=3000, chunk_overlap=300)
        child_splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=100)

        print("... Indexing Documents to MongoDB Atlas ...")
        
        # ParentDocumentRetriever automatically handles:
        # 1. Splitting Parents -> Children
        # 2. Saving Children to VectorStore (Atlas 'reports' collection)
        # 3. Saving Parents to DocStore (Atlas 'parent_docs' collection)
        self.base_retriever = ParentDocumentRetriever(
            vectorstore=self.vectorstore,
            docstore=self.docstore,
            child_splitter=child_splitter,
            parent_splitter=parent_splitter,
            search_kwargs={"k": 6}
        )
        self.base_retriever.add_documents(docs, ids=None)
        
        # Force a refresh of the retriever for the current session
        self._init_retriever()
        print("--- Ingestion Complete ---")

    def _init_retriever(self):
        """Helper to initialize the retriever chain if it doesn't exist"""
        parent_splitter = RecursiveCharacterTextSplitter(chunk_size=3000, chunk_overlap=300)
        child_splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=100)
        
        self.base_retriever = ParentDocumentRetriever(
            vectorstore=self.vectorstore,
            docstore=self.docstore,
            child_splitter=child_splitter,
            parent_splitter=parent_splitter,
            search_kwargs={"k": 6}
        )
        
        mq_prompt = ChatPromptTemplate.from_template(
            """You are an AI assistant helping to retrieve financial document information.
            Generate 3 different versions of the user question to improve retrieval.
            Original question: {question}
            Provide alternative questions:"""
        )
        
        self.multi_query_retriever = MultiQueryRetriever.from_llm(
            retriever=self.base_retriever,
            llm=self.llm,
            prompt=mq_prompt
        )

    def run_pipeline(self, question: str, debug: bool = True):
        print(f"\n\n{'='*70}")
        print(f"USER QUERY: {question}")
        print(f"{'='*70}")
        
        # Initialize retriever if this is a fresh run (no ingestion happened)
        if not self.multi_query_retriever:
            print("   > Initializing Retriever from existing Database...")
            self._init_retriever()

        # Step 1: Intelligent Retrieval
        print("   > Expanding Query & Retrieving...")
        docs = self.multi_query_retriever.invoke(question)
        
        print(f"   > Retrieved {len(docs)} relevant chunks.")
        
        if debug:
            print("\n   --- RETRIEVED CONTEXT PREVIEW ---")
            for idx, doc in enumerate(docs[:3]):
                preview = doc.page_content[:300].replace('\n', ' ')
                print(f"   [{idx+1}] {preview}...")
            print()

        # Step 2: Generation
        context = "\n\n".join([d.page_content for d in docs])
        answer = self.chains["rag"].invoke({"context": context, "question": question})
        
        print(f"\n{'='*70}")
        print(f"FINAL ANSWER:")
        print(f"{'='*70}")
        print(answer)
        print(f"{'='*70}\n")
        
        return answer

    def query(self, question: str, debug: bool = False):
        return self.run_pipeline(question, debug)
    
    
    def stream_query(self, question: str):
        """
        Generator function that yields the answer token-by-token.
        Uses the existing RAG chain.
        """
        # 1. RETRIEVAL (Must happen before we can start generating)
        # Check if retriever is ready
        if not self.multi_query_retriever:
            self._init_retriever()
            
        print(f"   > Streaming Query: {question}")
        
        # We fetch the relevant documents first
        docs = self.multi_query_retriever.invoke(question)
        context = "\n\n".join([d.page_content for d in docs])
        
        # 2. GENERATION (Streaming)
        # We use the existing chain you defined in __init__
        # The input structure must match what the chain expects: {"context": ..., "question": ...}
        
        input_data = {"context": context, "question": question}
        
        # .stream() automatically invokes the LLM in streaming mode
        for token in self.chains["rag"].stream(input_data):
            yield token