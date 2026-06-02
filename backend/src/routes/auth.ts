import { Router, Request, Response } from 'express';
import {
  getGoogleAuthUrl,
  getCalendarAuthUrl,
  handleGoogleCallback,
  verifyAndGetUser,
  fetchCalendarEvents,
} from '../services/googleAuth';
import { getAuthSessionsCollection, getUsersCollection } from '../db/mongodb';
import { randomUUID } from 'crypto';

const router = Router();

// ─────────────────────────────────────────────────────────────
// Session-scoped pending auth results.
// The callback writes to the session from Google OAuth "state"; Electron polls
// that exact authSessionId so users cannot consume each other's results.
// ─────────────────────────────────────────────────────────────
const AUTH_SESSION_TTL_MS = 5 * 60 * 1000;

async function createAuthSession(): Promise<string> {
  const authSessionId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
  await getAuthSessionsCollection().insertOne({ authSessionId, createdAt: now, expiresAt });
  return authSessionId;
}

function readAuthSessionId(req: Request): string {
  const raw = req.query.authSessionId ?? req.query.state;
  return typeof raw === 'string' ? raw.trim() : '';
}

async function requirePendingAuthSession(authSessionId: string) {
  if (!authSessionId) return null;
  return getAuthSessionsCollection().findOne({
    authSessionId,
    expiresAt: { $gt: new Date() },
  });
}

async function writeAuthSessionResult(authSessionId: string, data: any): Promise<boolean> {
  if (!authSessionId) return false;
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
  const result = await getAuthSessionsCollection().updateOne({
    authSessionId,
    expiresAt: { $gt: new Date() },
  }, {
    $set: { data, expiresAt },
  });
  return result.modifiedCount > 0;
}

async function deleteAuthSession(authSessionId: string): Promise<void> {
  if (!authSessionId) return;
  await getAuthSessionsCollection().deleteOne({ authSessionId });
}

// ─────────────────────────────────────────────────────────────
// GET /auth/google
// Returns the Google OAuth consent URL for sign-in
// ─────────────────────────────────────────────────────────────
router.get('/google', async (req: Request, res: Response) => {
  try {
    const loginHint = req.query.login_hint as string | undefined;
    const authSessionId = await createAuthSession();
    const authUrl = getGoogleAuthUrl(loginHint, authSessionId);
    res.json({ url: authUrl, authSessionId });
  } catch (error: any) {
    console.error('[AuthRoutes] Failed to generate auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /auth/google/callback
// Handles the OAuth redirect, exchanges code, upserts user
// Stores result by authSessionId for the Electron app to poll
// ─────────────────────────────────────────────────────────────
router.get('/google/callback', async (req: Request, res: Response) => {
  const authSessionId = readAuthSessionId(req);
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (!await requirePendingAuthSession(authSessionId)) {
      return res.status(400).send(getCallbackHTML(false, 'Authentication session expired. Please return to TeamSync and try again.'));
    }

    if (error) {
      await writeAuthSessionResult(authSessionId, { success: false, error: 'Authentication was cancelled.' });
      return res.send(getCallbackHTML(false, 'Authentication was cancelled.'));
    }

    if (!code) {
      await writeAuthSessionResult(authSessionId, { success: false, error: 'No authorization code received.' });
      return res.status(400).send(getCallbackHTML(false, 'No authorization code received.'));
    }

    const result = await handleGoogleCallback(code);

    const authData = {
      success: true,
      token: result.jwt,
      user: {
        name: result.user.name,
        email: result.user.email,
        picture: result.user.picture,
        calendarConnected: result.user.calendarConnected,
        isNewUser: result.isNewUser,
      },
    };

    // Store for polling — only the matching authSessionId can pick this up.
    await writeAuthSessionResult(authSessionId, authData);

    console.log(`[AuthRoutes] Auth result stored for polling session ${authSessionId} (user: ${result.user.email})`);

    // Return HTML page to the browser
    res.send(getCallbackHTML(true, undefined, result.jwt, {
      name: result.user.name,
      email: result.user.email,
      picture: result.user.picture,
      calendarConnected: result.user.calendarConnected,
      isNewUser: result.isNewUser,
    }));
  } catch (error: any) {
    console.error('[AuthRoutes] Google callback error:', error);
    if (authSessionId) {
      await writeAuthSessionResult(authSessionId, { success: false, error: error.message || 'Authentication failed.' });
    }
    res.status(500).send(getCallbackHTML(false, error.message || 'Authentication failed.'));
  }
});

// ─────────────────────────────────────────────────────────────
// POST /auth/calendar/disconnect
// Disconnects the calendar for the authenticated user
// ─────────────────────────────────────────────────────────────
router.post('/calendar/disconnect', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid token' });
    }
    const token = authHeader.split(' ')[1];
    const userPayload = await verifyAndGetUser(token);
    if (!userPayload) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const users = await getUsersCollection();
    await users.updateOne(
      { email: userPayload.email },
      { $set: { calendarConnected: false } }
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('[AuthRoutes] Failed to disconnect calendar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /auth/pending
// Poll this endpoint with authSessionId to pick up the auth result after callback.
// Returns the result once and clears only that session.
// ─────────────────────────────────────────────────────────────
router.get('/pending', async (req: Request, res: Response) => {
  const authSessionId = readAuthSessionId(req);
  if (!authSessionId) {
    return res.status(400).json({ success: false, error: 'authSessionId is required' });
  }

  const session = await requirePendingAuthSession(authSessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Authentication session not found or expired.' });
  }

  if (session.data) {
    await deleteAuthSession(authSessionId);
    return res.json(session.data);
  }

  res.json({ pending: true });
});

// ─────────────────────────────────────────────────────────────
// GET /auth/google/calendar
// Returns the Google OAuth consent URL for calendar access
// ─────────────────────────────────────────────────────────────
router.get('/google/calendar', async (req: Request, res: Response) => {
  try {
    const loginHint = req.query.login_hint as string | undefined;
    const authSessionId = await createAuthSession();
    const authUrl = getCalendarAuthUrl(loginHint, authSessionId);
    res.json({ url: authUrl, authSessionId });
  } catch (error: any) {
    console.error('[AuthRoutes] Failed to generate calendar auth URL:', error);
    res.status(500).json({ error: 'Failed to generate calendar auth URL' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /auth/me
// Returns the current user profile (requires Bearer token)
// ─────────────────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const user = await verifyAndGetUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({
      id: user._id!.toString(),
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      calendarConnected: user.calendarConnected,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    });
  } catch (error: any) {
    console.error('[AuthRoutes] /me error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /auth/calendar/events
// Returns upcoming calendar events (requires Bearer token)
// ─────────────────────────────────────────────────────────────
router.get('/calendar/events', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const user = await verifyAndGetUser(token);

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!user.calendarConnected) {
      return res.status(403).json({
        error: 'Calendar not connected',
        connectUrl: `/auth/google/calendar?login_hint=${encodeURIComponent(user.email)}`,
      });
    }

    const events = await fetchCalendarEvents(user);
    res.json({ events });
  } catch (error: any) {
    console.error('[AuthRoutes] Calendar events error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch events' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /auth/logout
// Clears calendar tokens from MongoDB + client-side logout
// ─────────────────────────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const user = await verifyAndGetUser(token);

      // Clear calendar tokens from MongoDB on logout
      if (user) {
        const usersCollection = getUsersCollection();
        await usersCollection.updateOne(
          { googleId: user.googleId },
          {
            $unset: {
              accessToken: '',
              refreshToken: '',
              tokenExpiry: '',
            },
            $set: {
              calendarConnected: false,
              calendarScopes: [],
              updatedAt: new Date(),
            },
          }
        );
        console.log(`[AuthRoutes] Cleared calendar tokens for user ${user.email}`);
      }
    }
    res.json({ success: true, message: 'Logged out. Calendar tokens cleared.' });
  } catch (error: any) {
    console.error('[AuthRoutes] Logout error:', error);
    res.json({ success: true, message: 'Logged out.' });
  }
});

// ─────────────────────────────────────────────────────────────
// Helper: Generate callback HTML that sends data to Electron
// ─────────────────────────────────────────────────────────────
function getCallbackHTML(
  success: boolean,
  errorMessage?: string,
  token?: string,
  user?: { name: string; email: string; picture?: string; calendarConnected: boolean; isNewUser: boolean }
): string {
    const data = success
    ? JSON.stringify({ success: true, token, user })
    : JSON.stringify({ success: false, error: errorMessage });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TeamSync – ${success ? 'Authentication Successful' : 'Authentication Failed'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #ffffff;
      color: #111827;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
      position: relative;
    }
    
      to { background-position: 60px 60px, 90px 90px; }
    }
    .container {
      text-align: center;
      padding: 40px;
      z-index: 10;
      animation: fadeIn 0.6s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .logo-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 32px;
    }
    .logo-icon { width: 48px; height: 48px; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    
    .logo-text {
      font-size: 42px;
      font-weight: 600;
      letter-spacing: -1px;
      color: #111827;
    }
    h1 { 
      font-size: 38px; 
      font-weight: 400; 
      margin-bottom: 24px; 
      letter-spacing: -0.5px;
      color: #111827;
    }
    p { 
      font-size: 18px; 
      color: #4b5563; 
      margin-bottom: 32px;
    }
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
    <div class="container">
    <div class="logo-container">
      <div class="logo-icon">
        <img src="data:image/png;base64,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" style="width:100%; height:100%; object-fit:cover;" alt="Team Sync Logo">
      </div>
      <div class="logo-text">Team Sync</div>
    </div>
    <h1>${success ? 'You have successfully authenticated.' : 'Authentication Failed'}</h1>
    <p>${success ? 'You should be redirected back to the product. <a href="teamsync://">Click here</a> if not working.' : (errorMessage || 'Something went wrong.')}</p>
  </div>
  <script>
    // Auto-close after a brief pause
    setTimeout(() => { window.close(); }, 3000);
  </script>
</body>
</html>`;
}

export default router;
