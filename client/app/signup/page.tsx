"use client";
import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from 'next/link';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://localhost:5000/api/auth/register', { email, password });
      login(res.data.token);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <Card className="p-8 w-96 space-y-4 shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-4">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <Input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <Button className="w-full bg-green-600 hover:bg-green-700">Sign Up</Button>
        </form>
        <div className="text-center text-sm">
          Have an account? <Link href="/login" className="text-blue-600 underline">Login</Link>
        </div>
      </Card>
    </div>
  );
}