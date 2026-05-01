import { Router, Request, Response } from 'express';
import {
  getGoogleAuthUrl,
  getCalendarAuthUrl,
  handleGoogleCallback,
  verifyAndGetUser,
  fetchCalendarEvents,
} from '../services/googleAuth';
import { getLicenseVerifyCollection, getUsersCollection } from '../db/mongodb';

const router = Router();

// ─────────────────────────────────────────────────────────────
// In-memory store for pending auth results.
// The callback page writes here; the Electron app polls to pick it up.
// Expires after 5 minutes. Only stores the latest result.
// ─────────────────────────────────────────────────────────────
let pendingAuthResult: { data: any; expiresAt: number } | null = null;

// ─────────────────────────────────────────────────────────────
// GET /auth/google
// Returns the Google OAuth consent URL for sign-in
// ─────────────────────────────────────────────────────────────
router.get('/google', (req: Request, res: Response) => {
  try {
    const loginHint = req.query.login_hint as string | undefined;
    const authUrl = getGoogleAuthUrl(loginHint);
    res.json({ url: authUrl });
  } catch (error: any) {
    console.error('[AuthRoutes] Failed to generate auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /auth/google/callback
// Handles the OAuth redirect, exchanges code, upserts user
// Stores result in memory for the Electron app to poll
// ─────────────────────────────────────────────────────────────
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      pendingAuthResult = {
        data: { success: false, error: 'Authentication was cancelled.' },
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
      return res.send(getCallbackHTML(false, 'Authentication was cancelled.'));
    }

    if (!code) {
      pendingAuthResult = {
        data: { success: false, error: 'No authorization code received.' },
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
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

    // Store for polling — Electron app picks this up
    pendingAuthResult = {
      data: authData,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    console.log(`[AuthRoutes] Auth result stored for polling (user: ${result.user.email})`);

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
    pendingAuthResult = {
      data: { success: false, error: error.message || 'Authentication failed.' },
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
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
// Poll this endpoint to pick up the auth result after callback
// Returns the result once and clears it (one-time read)
// ─────────────────────────────────────────────────────────────
router.get('/pending', (_req: Request, res: Response) => {
  if (pendingAuthResult && Date.now() < pendingAuthResult.expiresAt) {
    const result = pendingAuthResult.data;
    pendingAuthResult = null; // Clear after read
    return res.json(result);
  }

  // No pending result or expired
  res.json({ pending: true });
});

// ─────────────────────────────────────────────────────────────
// GET /auth/google/calendar
// Returns the Google OAuth consent URL for calendar access
// ─────────────────────────────────────────────────────────────
router.get('/google/calendar', (req: Request, res: Response) => {
  try {
    const loginHint = req.query.login_hint as string | undefined;
    const authUrl = getCalendarAuthUrl(loginHint);
    res.json({ url: authUrl });
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
// POST /auth/license/verify
// Check if a license key + device ID is valid in MongoDB
// Collection: licenseverify
// Schema: { licenseKey, deviceId, activatedAt, lastSeenAt, updatedAt }
// ─────────────────────────────────────────────────────────────
router.post('/license/verify', async (req: Request, res: Response) => {
  try {
    const { licenseKey, deviceId } = req.body;

    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ success: false, error: 'License key is required' });
    }
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'Device ID is required' });
    }

    const collection = getLicenseVerifyCollection();
    const trimmedKey = licenseKey.trim();
    const trimmedDevice = deviceId.trim();

    // Key must already exist in DB (pre-provisioned by admin)
    const existingKey = await collection.findOne({ licenseKey: trimmedKey });
    if (!existingKey) {
      return res.json({
        success: false,
        error: 'Invalid license key.',
      });
    }

    // One device = one key. A device already bound to another key cannot claim this key.
    const deviceWithDifferentKey = await collection.findOne({
      deviceId: trimmedDevice,
      licenseKey: { $ne: trimmedKey },
    });
    if (deviceWithDifferentKey) {
      return res.json({
        success: false,
        error: 'This device is already linked to another license key.',
      });
    }

    // If key is already bound to another device, reject.
    if (existingKey.deviceId && existingKey.deviceId !== trimmedDevice) {
      return res.json({
        success: false,
        error: 'This license key is already activated on another device.',
      });
    }

    const now = new Date();

    // If key exists but is unbound, bind it to this device during verification.
    if (!existingKey.deviceId) {
      await collection.updateOne(
        { _id: existingKey._id },
        {
          $set: {
            deviceId: trimmedDevice,
            activatedAt: existingKey.activatedAt ?? now,
            lastSeenAt: now,
            updatedAt: now,
          },
        }
      );

      return res.json({
        success: true,
        plan: 'pro',
        activated: true,
        message: 'License verified and activated for this device.',
      });
    }

    // Key already bound to this device, just refresh timestamps.
    await collection.updateOne(
      { _id: existingKey._id },
      { $set: { lastSeenAt: now, updatedAt: now } }
    );

    return res.json({
      success: true,
      plan: 'pro',
      activated: true,
      message: 'License verified for this device.',
    });

  } catch (error: any) {
    console.error('[AuthRoutes] License verify error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /auth/license/activate
// Bind a license key to a device ID in MongoDB
// One device = one key (stored in licenseverify collection)
// ─────────────────────────────────────────────────────────────
router.post('/license/activate', async (req: Request, res: Response) => {
  try {
    const { licenseKey, deviceId } = req.body;

    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ success: false, error: 'License key is required' });
    }
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'Device ID is required' });
    }

    const collection = getLicenseVerifyCollection();
    const trimmedKey = licenseKey.trim();
    const trimmedDevice = deviceId.trim();

    // Key must already exist in DB (pre-provisioned by admin).
    const existingKey = await collection.findOne({ licenseKey: trimmedKey });
    if (!existingKey) {
      return res.json({
        success: false,
        error: 'Invalid license key.',
      });
    }

    // Check if this key is already activated on another device
    if (existingKey.deviceId && existingKey.deviceId !== trimmedDevice) {
      return res.json({
        success: false,
        error: 'This license key is already activated on another device.',
      });
    }

    // Check if this device already has a different key
    const existingDevice = await collection.findOne({ deviceId: trimmedDevice });
    if (existingDevice && existingDevice.licenseKey !== trimmedKey) {
      return res.json({
        success: false,
        error: 'This device is already linked to another license key.',
      });
    }

    // If key+device already exist — just refresh timestamps
    if (existingKey && existingKey.deviceId === trimmedDevice) {
      await collection.updateOne(
        { _id: existingKey._id },
        { $set: { lastSeenAt: new Date(), updatedAt: new Date() } }
      );

      return res.json({
        success: true,
        plan: 'pro',
        message: 'License already active on this device.',
      });
    }

    // Existing unbound key: bind it to this device.
    const now = new Date();
    await collection.updateOne(
      { _id: existingKey._id },
      {
        $set: {
          deviceId: trimmedDevice,
          activatedAt: existingKey.activatedAt ?? now,
          lastSeenAt: now,
          updatedAt: now,
        },
      }
    );

    console.log(`[AuthRoutes] License bound: ${trimmedKey} to device ${trimmedDevice.slice(0, 8)}...`);

    res.json({
      success: true,
      plan: 'pro',
      message: 'Pro license activated successfully!',
    });

  } catch (error: any) {
    console.error('[AuthRoutes] License activate error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /auth/license/deactivate
// Remove a license key binding from a device
// ─────────────────────────────────────────────────────────────
router.post('/license/deactivate', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'Device ID is required' });
    }

    const collection = getLicenseVerifyCollection();
    const result = await collection.deleteOne({ deviceId: deviceId.trim() });

    if (result.deletedCount > 0) {
      console.log(`[AuthRoutes] License deactivated for device ${deviceId.slice(0, 8)}...`);
    }

    res.json({ success: true, message: 'License deactivated.' });
  } catch (error: any) {
    console.error('[AuthRoutes] License deactivate error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /auth/license/check-device
// Check if a device has an active license (by deviceId only)
// ─────────────────────────────────────────────────────────────
router.post('/license/check-device', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ success: false, error: 'Device ID is required' });
    }

    const collection = getLicenseVerifyCollection();
    const existing = await collection.findOne({ deviceId: deviceId.trim() });

    if (existing) {
      // Update lastSeenAt
      await collection.updateOne(
        { _id: existing._id },
        { $set: { lastSeenAt: new Date() } }
      );

      return res.json({
        success: true,
        isPremium: true,
        plan: 'pro',
        licenseKey: existing.licenseKey,
        activatedAt: existing.activatedAt,
      });
    }

    res.json({ success: true, isPremium: false });
  } catch (error: any) {
    console.error('[AuthRoutes] License check-device error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
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
  <title>Natively – ${success ? 'Sign In Successful' : 'Sign In Failed'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
    }
    .container {
      text-align: center;
      padding: 40px;
      animation: fadeIn 0.6s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      background: ${success ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)'};
      box-shadow: 0 0 40px ${success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};
    }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    p { font-size: 14px; color: #a0a0a0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${success ? '✓' : '✕'}</div>
    <h1>${success ? `Welcome, ${user?.name || 'User'}!` : 'Sign In Failed'}</h1>
    <p>${success ? 'You can close this window and return to Natively.' : (errorMessage || 'Something went wrong.')}</p>
  </div>
  <script>
    // Send auth result to Electron via custom protocol or window close
    try {
      const data = ${data};
      // Store in localStorage for the Electron app to pick up
      localStorage.setItem('natively_auth_result', JSON.stringify(data));
    } catch(e) {}
    // Auto-close after a brief pause
    setTimeout(() => { window.close(); }, 2500);
  </script>
</body>
</html>`;
}

export default router;
