"use client";

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, FileText, Plus, Loader2, LogOut } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

// Helper to generate a random Session ID
const generateSessionId = () => `session_${Math.random().toString(36).substring(7)}`;

type Message = {
  role: 'user' | 'assistant';
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

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return; 

    const initializeSession = async () => {
      let currentSessionId = localStorage.getItem('rag_session_id');

      if (!currentSessionId) {
        currentSessionId = generateSessionId();
        localStorage.setItem('rag_session_id', currentSessionId);
      }

      setSessionId(currentSessionId);

      try {
        const res = await axios.get(`http://localhost:5000/api/history/${currentSessionId}`);
        
        if (res.data.length > 0) {
          const history = res.data.map((msg: any) => ({
            role: msg.role,
            content: msg.content
          }));
          setMessages(history);
        } else {
          setMessages([{ role: 'assistant', content: 'Welcome back. I am ready to analyze your financial reports.' }]);
        }
      } catch (error) {
        console.error("Failed to recover history:", error);
        setMessages([{ role: 'assistant', content: 'Welcome. I am ready to analyze.' }]);
      }
    };

    initializeSession();
  }, [user]); 

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const startNewSession = () => {
    const newId = generateSessionId();
    setSessionId(newId);
    localStorage.setItem('rag_session_id', newId); 
    setMessages([{ role: 'assistant', content: 'New session started. How can I help?' }]);
  };

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;

    // 1. Add User Message
    const userMessage: Message = { role: 'user', content: query };
    setMessages(prev => [...prev, userMessage]);
    
    // 2. Prepare Placeholder for AI Response
    // We add an empty message that we will fill up text-by-text
    const aiMessagePlaceholder: Message = { role: 'assistant', content: "" };
    setMessages(prev => [...prev, aiMessagePlaceholder]);
    
    const currentQuery = query;
    setQuery("");
    setIsLoading(true);

    try {
      // 3. Start Streaming Request
      const response = await fetch('http://localhost:5000/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Note: Credentials (cookies) are handled automatically by browser for fetch
        },
        // We must include credentials to send the httpOnly cookie
        credentials: 'include', 
        body: JSON.stringify({
          message: currentQuery,
          sessionId: sessionId
        })
      });

      if (!response.body) throw new Error("No response body");

      // 4. Read the Stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulatedText = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          
          // Parse SSE format (data: {...})
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              
              if (dataStr === '[DONE]') {
                done = true;
                break;
              }

              try {
                const data = JSON.parse(dataStr);
                if (data.token) {
                  accumulatedText += data.token;
                  
                  // Update UI with new text
                  setMessages(prev => {
                    const newHistory = [...prev];
                    // Update the last message (the AI placeholder)
                    const lastMsg = newHistory[newHistory.length - 1];
                    lastMsg.content = accumulatedText;
                    return newHistory;
                  });
                }
              } catch (e) {
                // Ignore parse errors (common in streams)
              }
            }
          }
        }
      }

    } catch (error) {
      console.error("Stream Error:", error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "⚠️ **Error:** Connection failed." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading || !user) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin h-8 w-8 text-blue-600"/></div>;

  return (
    <div className="flex h-dvh bg-slate-50 overflow-hidden font-sans">
      
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-900 text-slate-50 flex flex-col border-r border-slate-800">
        <div className="p-4 border-b border-slate-800 flex items-center gap-2 font-bold text-lg tracking-tight">
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

        <ScrollArea className="flex-1 px-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 mb-2 px-2 uppercase tracking-wider">Session Info</p>
            <div className="px-2 py-1.5 text-xs text-slate-400 font-mono bg-slate-950 rounded border border-slate-800 truncate">
              ID: {sessionId}
            </div>
            <div className="mt-4 px-2">
                 <p className="text-xs text-slate-500 mb-1">LOGGED IN AS</p>
                 <p className="text-sm font-medium truncate">{user.email}</p>
            </div>
          </div>
        </ScrollArea>
        
        <div className="p-4 border-t border-slate-800 flex justify-between items-center">
          <span className="text-xs text-slate-500">v1.0.0</span>
          <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-slate-800">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col h-full relative">
        
        {/* Header */}
        <header className="h-14 border-b bg-white flex items-center px-6 justify-between shadow-sm z-10">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <FileText className="h-4 w-4 text-slate-500" />
            <span className="font-medium">Active Context:</span>
            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 text-xs font-bold">
              MongoDB Atlas Vector Store
            </span>
          </div>
        </header>

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0 p-4 bg-slate-50/50">
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                
                {msg.role === 'assistant' && (
                  <Avatar className="h-8 w-8 border bg-white shadow-sm mt-1">
                    <AvatarFallback><Bot className="h-4 w-4 text-blue-600" /></AvatarFallback>
                  </Avatar>
                )}

                <Card className={`p-4 max-w-[85%] shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white border-none' 
                    : 'bg-white border-slate-200 text-slate-800'
                }`}>
                  <div className={`text-sm leading-relaxed prose ${msg.role === 'user' ? 'prose-invert' : 'prose-slate'} max-w-none`}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </Card>

                {msg.role === 'user' && (
                   <Avatar className="h-8 w-8 border bg-white shadow-sm mt-1">
                    <AvatarFallback><User className="h-4 w-4 text-slate-600" /></AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-4" ref={scrollRef}>
                 <Avatar className="h-8 w-8 border bg-white shadow-sm mt-1">
                    <AvatarFallback><Loader2 className="h-4 w-4 text-blue-600 animate-spin" /></AvatarFallback>
                  </Avatar>
                  <div className="space-y-2 w-full max-w-md bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                    <div className="h-4 w-3/4 bg-slate-100 animate-pulse rounded"></div>
                    <div className="h-4 w-1/2 bg-slate-100 animate-pulse rounded"></div>
                  </div>
              </div>
            )}
            
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 bg-white border-t">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Input 
              placeholder="Ask about revenue, risks, or specific tables..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="flex-1 focus-visible:ring-blue-600"
              disabled={isLoading}
            />
            <Button onClick={handleSend} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 w-12 px-0">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="text-center mt-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">
              Powered by Mistral-Embed & Fireworks AI
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}