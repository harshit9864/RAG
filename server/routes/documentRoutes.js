import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';
import auth from '../middleware/auth.js';
import Document from '../models/Document.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";

// --- Multer Configuration ---
// Storage: save to server/uploads/{userId}/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', req.user.id);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve original name but add timestamp to avoid collisions
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// --- Helper: Forward file to Python for vector ingestion ---
async function forwardToPython(filePath, userId, documentId, documentName) {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('user_id', userId);
    form.append('document_id', documentId);
    form.append('document_name', documentName);

    await axios.post(`${PYTHON_API_URL}/upload`, form, {
      headers: form.getHeaders(),
      timeout: 120000 // 2 minute timeout for large PDFs
    });
    console.log(`✅ Forwarded "${documentName}" to Python for ingestion`);
    return true;
  } catch (error) {
    console.warn(`⚠️  Python forwarding failed for "${documentName}": ${error.message}`);
    console.warn('   Document record saved. Ingestion will happen when Python /upload endpoint is available.');
    return false;
  }
}

// --- Helper: Provision default PDF for a new user ---
export async function provisionDefaultDocument(userId) {
  const templateName = '2023ar_first_50_pages.pdf';
  const templatePath = path.join(__dirname, '..', 'templates', templateName);

  if (!fs.existsSync(templatePath)) {
    console.error(`❌ Default template not found: ${templatePath}`);
    return null;
  }

  // Create user upload directory
  const userDir = path.join(__dirname, '..', 'uploads', userId.toString());
  fs.mkdirSync(userDir, { recursive: true });

  // Copy template into the user's folder
  const destPath = path.join(userDir, templateName);
  fs.copyFileSync(templatePath, destPath);

  // Create document record
  const doc = await Document.create({
    name: templateName,
    fileName: templateName,
    userId: userId,
    fileUrl: `uploads/${userId}/${templateName}`,
    isDefault: true
  });

  // Attempt Python forwarding (non-blocking failure)
  forwardToPython(destPath, userId.toString(), doc._id.toString(), templateName);

  return doc;
}

// =============================================
//  ROUTES
// =============================================

// GET /api/documents — List user's documents
router.get('/', auth, async (req, res) => {
  try {
    const documents = await Document.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Could not fetch documents' });
  }
});

// POST /api/documents/upload — Upload a new PDF
router.post('/upload', auth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    // Create document record
    const doc = await Document.create({
      name: req.file.originalname,
      fileName: req.file.filename,
      userId: req.user.id,
      fileUrl: `uploads/${req.user.id}/${req.file.filename}`,
      isDefault: false
    });

    // Forward to Python for ingestion — WAIT for completion
    const ingested = await forwardToPython(req.file.path, req.user.id, doc._id.toString(), req.file.originalname);

    res.status(201).json({ ...doc.toObject(), ingested });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/documents/:id — Delete a document
router.delete('/:id', auth, async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify ownership
    if (doc.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this document' });
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '..', doc.fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete DB record
    await Document.findByIdAndDelete(req.params.id);

    res.json({ msg: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Could not delete document' });
  }
});

export default router;
