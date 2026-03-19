
import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  fileName: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileUrl: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Compound index for fast per-user queries
DocumentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Document', DocumentSchema);
