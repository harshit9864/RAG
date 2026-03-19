import os
import tempfile
import shutil
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from engine import VeriDocEngine
import uvicorn
import json

app = FastAPI()

class QueryRequest(BaseModel):
    question: str

class StreamRequest(BaseModel):
    question: str
    user_id: str = ""
    selected_doc_names: List[str] = []

print("Initializing AI Engine...")
try:
    rag_engine = VeriDocEngine()
    print("✅ AI Engine Ready!")
except Exception as e:
    print(f" Failed to initialize engine: {e}")
    rag_engine = None

@app.get("/")
def health_check():
    return {"status": "active"}

# --- NEW: Upload endpoint (receives files from Node.js) ---
@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    document_id: str = Form(...),
    document_name: str = Form(...)
):
    """
    Receives a PDF from the Node.js backend, saves it temporarily,
    and triggers vector ingestion with multi-tenant metadata.
    """
    if not rag_engine:
        raise HTTPException(status_code=500, detail="AI Engine not initialized")
    
    # Save uploaded file to a temp location
    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, document_name)
    
    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        print(f"📄 Received upload: {document_name} (user={user_id}, doc_id={document_id})")
        
        # Ingest with multi-tenant metadata
        rag_engine.ingest_document(
            file_path=temp_path,
            user_id=user_id,
            doc_id=document_id,
            doc_name=document_name
        )
        
        return {"status": "success", "message": f"Document '{document_name}' ingested successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
    
    finally:
        # Clean up temp file
        shutil.rmtree(temp_dir, ignore_errors=True)

# --- UPDATED: Streaming endpoint with multi-tenant filtering ---
@app.post("/stream")
async def stream_query_endpoint(request: StreamRequest):
    """
    Streaming endpoint. If user_id and selected_doc_ids are provided,
    uses filtered retrieval. Otherwise falls back to unfiltered (legacy).
    """
    if not rag_engine:
        raise HTTPException(status_code=500, detail="AI Engine not initialized")

    print(f"Request received: {request.question}")
    def event_stream():
        print("Generator entered")  # Check 2
        print(f"user_id: {request.user_id}")          # ADD THIS
        print(f"selected_doc_ids: {request.selected_doc_names}")  # ADD THIS
        print(f"condition: {bool(request.user_id and request.selected_doc_names)}")
        try:
            # Choose filtered vs unfiltered based on whether user_id is provided
            if request.user_id and request.selected_doc_names:
                generator = rag_engine.stream_query_filtered(
                    question=request.question,
                    user_id=request.user_id,
                    selected_doc_names=request.selected_doc_names
                )
            else:
                generator = rag_engine.stream_query(request.question)
            
            print("Generator created, starting iteration")  # Check 3
            for token in generator:
                yield f"data: {json.dumps({'token': token})}\n\n"
            
            yield "data: [DONE]\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)