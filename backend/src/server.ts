import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectToMongoDB, disconnectFromMongoDB } from './db/mongodb';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3456', 10);

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5180', 'http://localhost:3456', 'app://.*'],
  credentials: true,
}));
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────
async function start() {
  try {
    // Connect to MongoDB Atlas
    await connectToMongoDB();
    console.log('[Server] MongoDB connected');

    app.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
      console.log(`[Server] Google OAuth callback: http://localhost:${PORT}/auth/google/callback`);
      console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Server] Shutting down...');
  await disconnectFromMongoDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  await disconnectFromMongoDB();
  process.exit(0);
});

start();

export default app;
