import express from 'express';
import cors from 'cors';
import { connectToMongoDB, disconnectFromMongoDB } from './db/mongodb';
import authRoutes from './routes/auth';
import { attachV1WebSocketServer, createV1Router } from './routes/v1';
import { getBackendConfig } from './config/env';
import licensingRoutes from './licensing/routes';
import webhookRoutes from './licensing/routes/webhooks';
import adminRoutes from './routes/admin';

const backendConfig = getBackendConfig();

const app = express();
const PORT = backendConfig.port;
const ALLOWED_ORIGINS = new Set([
  'https://apiteamsync.duckdns.org',
  'https://api.teamsync.ai',
  'http://localhost:5180',
  'http://localhost:3000',
  'http://localhost:3456',
]);

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      origin === 'null' ||
      ALLOWED_ORIGINS.has(origin) ||
      origin.startsWith('app://') ||
      origin.startsWith('file://')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({
  limit: '16mb',
  verify: (req, _res, buffer) => {
    (req as any).rawBody = Buffer.from(buffer);
  },
}));

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/license', licensingRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/admin', adminRoutes);
app.use('/v1', createV1Router());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    routes: {
      auth: true,
      license: true,
      webhooks: true,
      v1: {
        chat: true,
        usage: true,
        transcribe: true,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────
async function start() {
  try {
    // Connect to MongoDB Atlas
    await connectToMongoDB();
    console.log('[Server] MongoDB connected');

    const server = app.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      console.log(`[Server] Google OAuth callback: ${backendConfig.redirectUri}`);
      console.log(`[Server] Health check: /health`);
    });
    attachV1WebSocketServer(server);
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
