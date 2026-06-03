const { test }: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

export {};

function readRepoFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('TeamSync API routing has a single DuckDNS source of truth', () => {
  const config = readRepoFile('src/lib/config/apiConfig.ts');
  const helper = readRepoFile('electron/LLMHelper.ts');
  const ipc = readRepoFile('electron/ipcHandlers.ts');
  const stt = readRepoFile('electron/audio/TeamSyncProSTT.ts');

  assert.match(config, /DEFAULT_API_BASE_URL = 'https:\/\/apiteamsync\.duckdns\.org'/);
  assert.match(config, /TEAMSYNC_API_ROUTES/);
  assert.match(config, /TEAMSYNC_CHAT_URL/);
  assert.match(config, /TEAMSYNC_USAGE_URL/);
  assert.match(config, /TEAMSYNC_TRANSCRIBE_URL/);

  assert.match(helper, /TEAMSYNC_CHAT_URL/);
  assert.match(ipc, /TEAMSYNC_USAGE_URL/);
  assert.match(stt, /TEAMSYNC_TRANSCRIBE_URL/);

  assert.doesNotMatch(helper, /api\.teamsync-ai\.vercel\.app/);
  assert.doesNotMatch(ipc, /api\.teamsync-ai\.vercel\.app/);
  assert.doesNotMatch(stt, /api\.teamsync-ai\.vercel\.app/);
});

test('production CSP removes localhost backend and campaign-sand while dev CSP keeps localhost', () => {
  const html = readRepoFile('index.html');
  const vite = readRepoFile('vite.config.mts');
  const productionStart = vite.indexOf('const productionCsp');
  const developmentStart = vite.indexOf('const developmentCsp');
  const pluginStart = vite.indexOf('function teamSyncCspPlugin');

  assert.match(html, /%TEAMSYNC_CSP%/);
  assert.ok(productionStart >= 0);
  assert.ok(developmentStart > productionStart);
  assert.ok(pluginStart > developmentStart);

  const productionCsp = vite.slice(productionStart, developmentStart);
  const developmentCsp = vite.slice(developmentStart, pluginStart);

  assert.match(productionCsp, /https:\/\/apiteamsync\.duckdns\.org/);
  assert.match(productionCsp, /wss:\/\/apiteamsync\.duckdns\.org/);
  assert.doesNotMatch(productionCsp, /localhost:3456/);
  assert.doesNotMatch(productionCsp, /campaign-sand\.vercel\.app/);

  assert.match(developmentCsp, /localhost:3456/);
});

test('release debug IPC cleanup removes release-feed test bridge and preserves seed-demo', () => {
  const ipc = readRepoFile('electron/ipcHandlers.ts');
  const main = readRepoFile('electron/main.ts');
  const processingHelper = readRepoFile('electron/ProcessingHelper.ts');

  assert.doesNotMatch(ipc, /test-release-fetch/);
  assert.doesNotMatch(ipc, /safeDevelopmentHandle/);
  assert.doesNotMatch(ipc, /isDevelopmentOnlyIpcAllowed/);
  assert.match(ipc, /safeHandle\("seed-demo"/);

  for (const channel of [
    'flush-database',
    'stt:debug-simulate-failure',
    'stt:debug-prime-replay-buffer',
    'stt:set-debug-enabled',
    'stt:get-debug-enabled',
    'stt:run-failover-validation',
    'stt:run-load-test',
    'analyze-image-file',
  ]) {
    assert.doesNotMatch(ipc, new RegExp(escapeRegex(channel)));
  }

  assert.doesNotMatch(main, /intelligence:enable-dev-mode/);
  assert.doesNotMatch(main, /PROCESSING_EVENTS/);
  assert.doesNotMatch(processingHelper, /processScreenshots\(/);
  assert.doesNotMatch(processingHelper, /currentProcessingAbortController/);
  assert.doesNotMatch(processingHelper, /currentExtraProcessingAbortController/);
});

test('OAuth callback no longer writes legacy natively_auth_result localStorage fallback', () => {
  const auth = readRepoFile('backend/src/routes/auth.ts');
  const googleAuthManager = readRepoFile('electron/services/GoogleAuthManager.ts');

  assert.doesNotMatch(auth, /natively_auth_result/);
  assert.doesNotMatch(auth, /localStorage\.setItem\(/);
  assert.match(googleAuthManager, /\/auth\/pending\?authSessionId=/);
});

test('backend v1 routes are present and Vercel chat endpoint usage is removed', () => {
  const server = readRepoFile('backend/src/server.ts');
  const routes = readRepoFile('backend/src/routes/v1.ts');
  const helper = readRepoFile('electron/LLMHelper.ts');

  assert.match(server, /app\.use\('\/v1', createV1Router\(\)\)/);
  assert.match(routes, /router\.post\('\/chat'/);
  assert.match(routes, /router\.get\('\/usage'/);
  assert.match(routes, /\/v1\/transcribe/);

  assert.doesNotMatch(helper, /https:\/\/api\.teamsync-ai\.vercel\.app\/v1\/chat/);
  assert.doesNotMatch(routes, /api\.teamsync-ai\.vercel\.app/);
});
