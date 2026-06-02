const DEFAULT_API_BASE_URL = 'https://apiteamsync.duckdns.org';

const configuredApiBaseUrl =
  typeof process !== 'undefined'
    ? process.env?.VITE_API_URL
    : undefined;

export const API_BASE_URL = (configuredApiBaseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/g, '');

export const TEAMSYNC_API_ROUTES = {
  chat: '/v1/chat',
  usage: '/v1/usage',
  transcribe: '/v1/transcribe',
} as const;

export const TEAMSYNC_CHAT_URL = `${API_BASE_URL}${TEAMSYNC_API_ROUTES.chat}`;
export const TEAMSYNC_USAGE_URL = `${API_BASE_URL}${TEAMSYNC_API_ROUTES.usage}`;

export const TEAMSYNC_WS_BASE_URL = API_BASE_URL
  .replace(/^https:/i, 'wss:')
  .replace(/^http:/i, 'ws:');

export const TEAMSYNC_TRANSCRIBE_URL = `${TEAMSYNC_WS_BASE_URL}${TEAMSYNC_API_ROUTES.transcribe}`;
