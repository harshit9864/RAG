"use client";
import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://localhost:5713/api/auth/login', { email, password });
      login(res.data.token);
    } catch (err: any) {
      setError(err.response?.data?.msg || 'Login failed');
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <Card className="p-8 w-96 space-y-4 shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-4">VeriDoc Login</h1>
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <Input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <Button className="w-full bg-blue-600">Login</Button>
        </form>
        <div className="text-center text-sm">
          No account? <Link href="/signup" className="text-blue-600 underline">Sign up</Link>
        </div>
      </Card>
    </div>
  );
}