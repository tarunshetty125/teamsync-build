import { google, Auth } from 'googleapis';
import { getUsersCollection, UserDocument } from '../db/mongodb';
import jwt from 'jsonwebtoken';

const SCOPES_BASIC = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

const SCOPES_CALENDAR = [
  'https://www.googleapis.com/auth/calendar.readonly',
];

function createOAuth2Client(): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
  );
}

/**
 * Generate the Google OAuth consent URL for sign-in (basic scopes only)
 */
export function getGoogleAuthUrl(loginHint?: string): string {
  const oauth2Client = createOAuth2Client();
  
  const options: Auth.GenerateAuthUrlOpts = {
    access_type: 'offline',
    scope: SCOPES_BASIC,
    prompt: 'consent',
    include_granted_scopes: true,
  };

  if (loginHint) {
    (options as any).login_hint = loginHint;
  }

  return oauth2Client.generateAuthUrl(options);
}

/**
 * Generate incremental auth URL for calendar (requests only calendar scope)
 */
export function getCalendarAuthUrl(loginHint?: string): string {
  const oauth2Client = createOAuth2Client();

  const options: Auth.GenerateAuthUrlOpts = {
    access_type: 'offline',
    scope: [...SCOPES_BASIC, ...SCOPES_CALENDAR],
    prompt: 'consent',
    include_granted_scopes: true,
  };

  if (loginHint) {
    (options as any).login_hint = loginHint;
  }

  return oauth2Client.generateAuthUrl(options);
}

/**
 * Exchange authorization code for tokens, fetch user info, upsert in MongoDB
 */
export async function handleGoogleCallback(code: string): Promise<{
  user: UserDocument;
  jwt: string;
  isNewUser: boolean;
}> {
  const oauth2Client = createOAuth2Client();

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch user info from Google
  const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
  const { data: userInfo } = await oauth2.userinfo.get();

  if (!userInfo.id || !userInfo.email) {
    throw new Error('Failed to retrieve user information from Google');
  }

  // Check granted scopes
  const grantedScopes = tokens.scope?.split(' ') || [];
  const hasCalendarScope = grantedScopes.some(s => 
    s.includes('calendar')
  );

  // Upsert user in MongoDB
  const usersCollection = getUsersCollection();
  const now = new Date();

  const existingUser = await usersCollection.findOne({ googleId: userInfo.id });
  const isNewUser = !existingUser;

  const updateDoc: Partial<UserDocument> = {
    googleId: userInfo.id,
    email: userInfo.email,
    name: userInfo.name || userInfo.email,
    picture: userInfo.picture || undefined,
    accessToken: tokens.access_token || undefined,
    refreshToken: tokens.refresh_token || existingUser?.refreshToken || undefined,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    calendarConnected: hasCalendarScope,
    calendarScopes: hasCalendarScope ? SCOPES_CALENDAR : [],
    updatedAt: now,
    lastLoginAt: now,
  };

  if (isNewUser) {
    updateDoc.createdAt = now;
  }

  await usersCollection.updateOne(
    { googleId: userInfo.id },
    { $set: updateDoc },
    { upsert: true }
  );

  const user = await usersCollection.findOne({ googleId: userInfo.id });
  if (!user) {
    throw new Error('Failed to upsert user');
  }

  // Generate JWT
  const jwtToken = jwt.sign(
    {
      userId: user._id!.toString(),
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '30d' }
  );

  return { user, jwt: jwtToken, isNewUser };
}

/**
 * Verify JWT and return user data
 */
export async function verifyAndGetUser(token: string): Promise<UserDocument | null> {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
    const usersCollection = getUsersCollection();
    return await usersCollection.findOne({ googleId: decoded.googleId });
  } catch {
    return null;
  }
}

/**
 * Fetch calendar events using stored credentials
 */
export async function fetchCalendarEvents(user: UserDocument): Promise<any[]> {
  if (!user.accessToken || !user.calendarConnected) {
    throw new Error('Calendar not connected or no access token');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
  });

  // Handle token refresh
  if (user.tokenExpiry && new Date() >= user.tokenExpiry) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    // Update stored tokens
    const usersCollection = getUsersCollection();
    await usersCollection.updateOne(
      { googleId: user.googleId },
      {
        $set: {
          accessToken: credentials.access_token || undefined,
          tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
          updatedAt: new Date(),
        },
      }
    );

    oauth2Client.setCredentials(credentials);
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: tomorrow.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const items = response.data.items || [];

  return items
    .filter((item: any) => {
      if (!item.start?.dateTime || !item.end?.dateTime) return false;
      const start = new Date(item.start.dateTime).getTime();
      const end = new Date(item.end.dateTime).getTime();
      const durationMins = (end - start) / 60000;
      return durationMins >= 5;
    })
    .map((item: any) => ({
      id: item.id,
      title: item.summary || '(No Title)',
      startTime: item.start!.dateTime,
      endTime: item.end!.dateTime,
      link: item.hangoutLink || extractMeetingLink(item.description || ''),
      source: 'google',
    }));
}

function extractMeetingLink(description: string): string | undefined {
  const providerRegex = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s<>"']+)/gi;
  const matches = description.match(providerRegex);
  return matches?.[0];
}
