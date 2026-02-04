import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {Chat} from './models/chat.js';
import User from './models/User.js';
import auth from './middleware/auth.js';

dotenv.config();
const app = express();

// 1. MIDDLEWARE
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 5000;
const PYTHON_API_URL = "http://127.0.0.1:8000";

// DB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error(err));

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 5 * 24 * 60 * 60 * 1000 
};

// --- AUTH ROUTES (Same as before) ---
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: 'User already exists' });

    user = new User({ email, password });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    const payload = { user: { id: user.id } };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5d' }, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, cookieOptions).json({ msg: 'Registered successfully' });
    });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid Credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid Credentials' });

    const payload = { user: { id: user.id } };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5d' }, (err, token) => {
      if (err) throw err;
      res.cookie('token', token, cookieOptions).json({ msg: 'Logged in successfully' });
    });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token').json({ msg: 'Logged out' });
});

app.get('/api/auth/user', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// --- CHAT ROUTES ---

// NEW: STREAMING ENDPOINT
app.post('/api/chat/stream', auth, async (req, res) => {
  const { message, sessionId } = req.body;

  // 1. Setup headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 2. Save User Message Immediately
    await Chat.create({ sessionId, user: req.user.id, role: 'user', content: message });

    // 3. Connect to Python Stream
    const pythonResponse = await axios.post(`${PYTHON_API_URL}/stream`, 
      { question: message },
      { responseType: 'stream' } // Critical: Tell Axios to stream the response
    );

    let fullAiResponse = "";

    // 4. Pipe Python Data -> Frontend
    pythonResponse.data.on('data', (chunk) => {
      const line = chunk.toString();
      
      // Pass the raw chunk to frontend
      res.write(line);

      // Accumulate text for Database (Parse the JSON "token")
      // Chunk format: "data: {"token": "hello"}\n\n"
      try {
        const parts = line.split('data: ');
        parts.forEach(part => {
           if (part.trim() && part !== '[DONE]') {
              const jsonStr = part.trim();
              try {
                const data = JSON.parse(jsonStr);
                if (data.token) fullAiResponse += data.token;
              } catch (e) { /* Ignore parsing errors for partial chunks */ }
           }
        });
      } catch (e) {
        console.error("Parsing error", e);
      }
    });

    // 5. When Stream Ends: Save complete answer to DB
    pythonResponse.data.on('end', async () => {
      if (fullAiResponse.trim()) {
        await Chat.create({ 
          sessionId, 
          user: req.user.id, 
          role: 'assistant', 
          content: fullAiResponse 
        });
      }
      res.end();
    });

  } catch (error) {
    console.error("Streaming Error:", error.message);
    res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
    res.end();
  }
});

// GET HISTORY
app.get('/api/history/:sessionId', auth, async (req, res) => {
  try {
    const history = await Chat.find({ sessionId: req.params.sessionId, user: req.user.id }).sort({ timestamp: 1 });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Could not fetch history" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));