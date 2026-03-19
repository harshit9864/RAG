"use client";

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Bot,
  User,
  FileText,
  Plus,
  Loader2,
  LogOut,
  FileSearch,
  Upload,
  Trash2,
  CheckSquare,
  Square,
  FileUp,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// Dynamic import for PDF Viewer to avoid server-side errors
const PDFViewer = dynamic(() => import("./components/PDFViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-125 bg-slate-50 border-l flex items-center justify-center text-slate-400">
      Loading Document Engine...
    </div>
  ),
});

const API_BASE = "http://localhost:5000";

const generateSessionId = () =>
  `session_${Math.random().toString(36).substring(7)}`;

type Message = {
  role: "user" | "assistant";
  content: string;
};

type UserDocument = {
  _id: string;
  name: string;
  fileName: string;
  userId: string;
  fileUrl: string;
  isDefault: boolean;
  createdAt: string;
};

export default function FinancialAgent() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // PDF State
  const [isPdfOpen, setIsPdfOpen] = useState(false);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [currentPdfUrl, setCurrentPdfUrl] = useState("");
  const [currentPdfName, setCurrentPdfName] = useState("");

  // Document Management State
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Auth Check
  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  // 2. Load History
  useEffect(() => {
    if (!user) return;
    const initializeSession = async () => {
      let currentSessionId = localStorage.getItem("rag_session_id");
      if (!currentSessionId) {
        currentSessionId = generateSessionId();
        localStorage.setItem("rag_session_id", currentSessionId);
      }
      setSessionId(currentSessionId);

      try {
        const res = await axios.get(
          `${API_BASE}/api/history/${currentSessionId}`,
        );
        if (res.data.length > 0) {
          setMessages(
            res.data.map((msg: any) => ({
              role: msg.role,
              content: msg.content,
            })),
          );
        } else {
          setMessages([
            {
              role: "assistant",
              content: "Welcome. I am ready to analyze your financial reports.",
            },
          ]);
        }
      } catch (error) {
        setMessages([
          { role: "assistant", content: "Welcome. I am ready to analyze." },
        ]);
      }
    };
    initializeSession();
  }, [user]);

  // 3. Load Documents
  useEffect(() => {
    if (!user) return;
    fetchDocuments();
  }, [user]);

  const fetchDocuments = async () => {
    try {
      setLoadingDocs(true);
      const res = await axios.get(`${API_BASE}/api/documents`);
      const docs: UserDocument[] = res.data;
      setDocuments(docs);
      // Auto-select all documents by default
      setSelectedDocIds(new Set(docs.map((d) => d._id)));
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    } finally {
      setLoadingDocs(false);
    }
  };

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const startNewSession = () => {
    const newId = generateSessionId();
    setSessionId(newId);
    localStorage.setItem("rag_session_id", newId);
    setMessages([
      { role: "assistant", content: "New session started. How can I help?" },
    ]);
    setIsPdfOpen(false);
  };

  // --- Document Management ---
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("document", file);

    try {
      setUploadingDoc(true);
      const res = await axios.post(`${API_BASE}/api/documents/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Add new doc to state and auto-select it
      const newDoc: UserDocument = res.data;
      setDocuments((prev) => [newDoc, ...prev]);
      setSelectedDocIds((prev) => new Set([...prev, newDoc._id]));
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploadingDoc(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await axios.delete(`${API_BASE}/api/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d._id !== docId));
      setSelectedDocIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  // --- Citation Parsing ---
  const preprocessText = (text: string) => {
    // Match [DocName, Page X] or [DocName, Page X-Y]  
    return text.replace(
      /\[([^\],]+),\s*Page\s+([^\]]+)\]/g,
      (match, docName, pageNumText) => {
        const trimmedDocName = docName.trim();
        const firstPage = parseInt(pageNumText);
        return ` **[${trimmedDocName}, Page ${pageNumText}](http://open-pdf/${encodeURIComponent(trimmedDocName)}/page/${firstPage})** `;
      },
    );
  };

  const handlePdfClick = (docName: string, page: number) => {
    // Find the document by name — try exact match first, then case-insensitive, then partial
    const normalizedName = docName.trim().toLowerCase();
    const doc =
      documents.find((d) => d.name === docName) ||
      documents.find((d) => d.name.toLowerCase() === normalizedName) ||
      documents.find((d) => d.name.toLowerCase().includes(normalizedName) || normalizedName.includes(d.name.toLowerCase()));

    if (doc) {
      setCurrentPdfUrl(`${API_BASE}/${doc.fileUrl}`);
      setCurrentPdfName(doc.name);
    } else {
      console.warn(`Could not find document "${docName}" in user documents:`, documents.map(d => d.name));
      // Last resort: use the first selected document
      const fallbackDoc = documents.find((d) => selectedDocIds.has(d._id));
      if (fallbackDoc) {
        setCurrentPdfUrl(`${API_BASE}/${fallbackDoc.fileUrl}`);
        setCurrentPdfName(fallbackDoc.name);
      } else {
        return; // No document to show
      }
    }
    setCurrentPdfPage(page);
    setIsPdfOpen(true);
  };

  // --- Chat ---
  const handleSend = async () => {
    if (!query.trim() || isLoading || uploadingDoc) return;

    const userMessage: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMessage]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const currentQuery = query;
    setQuery("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: currentQuery,
          sessionId: sessionId,
          selectedDocumentNames: documents
            .filter((d) => selectedDocIds.has(d._id))
            .map((d) => d.name),
        }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulatedText = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.replace("data: ", "").trim();
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }
              try {
                const data = JSON.parse(dataStr);
                if (data.token) {
                  accumulatedText += data.token;
                  setMessages((prev) => {
                    const newHistory = [...prev];
                    newHistory[newHistory.length - 1].content = accumulatedText;
                    return newHistory;
                  });
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Connection failed." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading || !user)
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
      </div>
    );

  return (
    // Main Container
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-72 bg-slate-900 text-slate-50 flex flex-col border-r border-slate-800 shrink-0">
        <div className="p-4 border-b border-slate-800 flex items-center gap-2 font-bold text-lg">
          <Bot className="h-6 w-6 text-blue-400" />
          <span>VeriDoc AI</span>
        </div>

        <div className="p-4">
          <Button
            onClick={startNewSession}
            variant="secondary"
            className="w-full justify-start gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border-none"
          >
            <Plus className="h-4 w-4" /> New Analysis
          </Button>
        </div>

        {/* Document Management Section */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                My Documents
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingDoc}
                className="flex items-center gap-1 text-[10px] font-medium text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50 px-2 py-1 rounded hover:bg-slate-800"
              >
                {uploadingDoc ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FileUp className="h-3 w-3" />
                )}
                Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleUpload}
                className="hidden"
              />
            </div>

            {loadingDocs ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              </div>
            ) : documents.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                No documents uploaded yet
              </p>
            ) : (
              <div className="space-y-1">
                {documents.map((doc) => (
                  <div
                    key={doc._id}
                    className="group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-800/70 transition-colors"
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleDocSelection(doc._id)}
                      className="shrink-0 text-slate-400 hover:text-blue-400 transition-colors"
                      title={
                        selectedDocIds.has(doc._id)
                          ? "Deselect from context"
                          : "Select for context"
                      }
                    >
                      {selectedDocIds.has(doc._id) ? (
                        <CheckSquare className="h-4 w-4 text-blue-400" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>

                    {/* Doc info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3 text-slate-500 shrink-0" />
                        <span className="text-xs text-slate-300 truncate block">
                          {doc.name}
                        </span>
                        {doc.isDefault && (
                          <span title="Default document"><Star className="h-3 w-3 text-amber-400 shrink-0" /></span>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteDoc(doc._id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
                      title="Delete document"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-slate-800 my-3" />

            {/* Session Info */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Session Info
            </p>
            <div className="px-2 py-1.5 text-xs text-slate-400 font-mono bg-slate-950 rounded border border-slate-800 truncate">
              ID: {sessionId}
            </div>
            <div className="mt-2 px-2">
              <p className="text-xs text-slate-500 mb-1">LOGGED IN AS</p>
              <p className="text-sm font-medium truncate">{user.email}</p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-between items-center">
          <span className="text-xs text-slate-500">v2.0.0</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative min-w-0">
        <header className="h-14 border-b bg-white flex items-center px-6 justify-between shadow-sm z-10 shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText className="h-4 w-4 text-slate-500" />
            <span className="font-medium">Active Context:</span>
            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 text-xs font-bold">
              {selectedDocIds.size} of {documents.length} document{documents.length !== 1 ? "s" : ""} selected
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <Avatar className="h-8 w-8 border bg-white shadow-sm mt-1">
                    <AvatarFallback>
                      <Bot className="h-4 w-4 text-blue-600" />
                    </AvatarFallback>
                  </Avatar>
                )}

                <Card
                  className={`p-4 max-w-[85%] shadow-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white border-none"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                >
                  <div
                    className={`text-sm leading-relaxed prose ${msg.role === "user" ? "prose-invert" : "prose-slate"} max-w-none`}
                  >
                    <ReactMarkdown
                      components={{
                        a: ({ node, href, children, ...props }) => {
                          // Check for our special multi-doc URL format
                          if (href?.includes("http://open-pdf/")) {
                            // Parse: http://open-pdf/{docName}/page/{pageNum}
                            const match = href.match(
                              /http:\/\/open-pdf\/(.+?)\/page\/(\d+)/,
                            );
                            if (match) {
                              const docName = decodeURIComponent(match[1]);
                              const pageNum = parseInt(match[2]);

                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handlePdfClick(docName, pageNum);
                                  }}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-1 -my-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold transition-colors border border-blue-200 align-middle"
                                >
                                  <FileSearch className="w-3 h-3" />
                                  {children}
                                </button>
                              );
                            }
                          }
                          // Normal external links
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              {...props}
                              className="text-blue-600 hover:underline"
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {preprocessText(msg.content)}
                    </ReactMarkdown>
                  </div>
                </Card>

                {msg.role === "user" && (
                  <Avatar className="h-8 w-8 border bg-white shadow-sm mt-1">
                    <AvatarFallback>
                      <User className="h-4 w-4 text-slate-600" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-center p-2">
                <Loader2 className="animate-spin h-5 w-5 text-slate-400" />
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </div>

        <div className="p-4 bg-white border-t shrink-0">
          {uploadingDoc && (
            <div className="max-w-3xl mx-auto mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Ingesting document... Chat and uploads are paused until processing is complete.
            </div>
          )}
          <div className="max-w-3xl mx-auto flex gap-2">
            <Input
              placeholder={uploadingDoc ? "Waiting for document ingestion..." : "Ask about revenue, risks, or specific tables..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="flex-1 focus-visible:ring-blue-600"
              disabled={isLoading || uploadingDoc}
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || uploadingDoc}
              className="bg-blue-600 hover:bg-blue-700 w-12 px-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="text-center mt-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">
              Powered by Mistral-Embed & Fireworks AI
            </p>
          </div>
        </div>
      </div>


      {/* "Currently I'm saving PDFs to disk for simplicity, but in production I'd replace this with cloud object storage like AWS S3, generate signed URLs for secure access, and process files in memory to avoid disk dependency — this would also make the app stateless and horizontally scalable." */}
      {isPdfOpen && (
        <PDFViewer
          file={currentPdfUrl}
          pageNumber={currentPdfPage}
          onClose={() => setIsPdfOpen(false)}
          docName={currentPdfName}
        />
      )}
    </div>
  );
}
