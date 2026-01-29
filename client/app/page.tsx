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

const generateSessionId = () =>
  `session_${Math.random().toString(36).substring(7)}`;

type Message = {
  role: "user" | "assistant";
  content: string;
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
          `http://localhost:5000/api/history/${currentSessionId}`,
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

  const preprocessText = (text: string) => {
    // Regex explanation:
    // \[Page : Matches literal "[Page "
    // ([^\]]+) : Captures ANY character until the closing bracket (captures "37-38")
    // \] : Matches literal closing bracket
    return text.replace(/\[Page ([^\]]+)\]/g, (match, pageNumText) => {
      // 1. We have the full text, e.g., "37-38"
      // 2. parseInt stops at non-digits, so parseInt("37-38") returns 37.
      const firstPage = parseInt(pageNumText);

      // 3. We construct the Markdown Link:
      // Label: "[Page 37-38]" (Preserves the range visual)
      // Link:  "http://open-pdf/page/37" (Jumps to the start page)
      return ` **[Page ${pageNumText}](http://open-pdf/page/${firstPage})** `;
    });
  };

  const handlePdfClick = (page: number) => {
    setCurrentPdfPage(page);
    setIsPdfOpen(true);
  };

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: query };
    setMessages((prev) => [...prev, userMessage]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const currentQuery = query;
    setQuery("");
    setIsLoading(true);

    try {
      const response = await fetch("http://localhost:5000/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: currentQuery, sessionId: sessionId }),
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
    // FIX 1: Main Container is h-screen and flex row
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* FIX 2: Sidebar gets fixed width and shrink-0 so it never collapses */}
      <div className="w-64 bg-slate-900 text-slate-50 flex flex-col border-r border-slate-800 shrink-0">
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

        {/* Sidebar History - Standard Overflow */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 mb-2 px-2 uppercase">
              Session Info
            </p>
            <div className="px-2 py-1.5 text-xs text-slate-400 font-mono bg-slate-950 rounded border border-slate-800 truncate">
              ID: {sessionId}
            </div>
            <div className="mt-4 px-2">
              <p className="text-xs text-slate-500 mb-1">LOGGED IN AS</p>
              <p className="text-sm font-medium truncate">{user.email}</p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-between items-center">
          <span className="text-xs text-slate-500">v1.0.0</span>
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
              Annual Report (2023)
            </span>
          </div>
        </header>

        {/* FIX 3: Replaced ScrollArea with standard div overflow-y-auto */}
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
                        // Inside ReactMarkdown components={{ ... }}
                        a: ({ node, href, children, ...props }) => {
                          // Check for our special fake URL
                          if (href?.includes("http://open-pdf/page/")) {
                            const pageNum = parseInt(
                              href.split("/").pop() || "1",
                            );

                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault(); // Stop navigation
                                  e.stopPropagation(); // Stop bubbling
                                  handlePdfClick(pageNum);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-1 -my-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-bold transition-colors border border-blue-200 align-middle"
                              >
                                <FileSearch className="w-3 h-3" />
                                {children}
                              </button>
                            );
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
          <div className="max-w-3xl mx-auto flex gap-2">
            <Input
              placeholder="Ask about revenue, risks, or specific tables..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="flex-1 focus-visible:ring-blue-600"
              disabled={isLoading}
            />
            <Button
              onClick={handleSend}
              disabled={isLoading}
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

      {/* PDF VIEWER PANEL */}
      {isPdfOpen && (
        <PDFViewer
          file="/report.pdf"
          pageNumber={currentPdfPage}
          onClose={() => setIsPdfOpen(false)}
        />
      )}
    </div>
  );
}
