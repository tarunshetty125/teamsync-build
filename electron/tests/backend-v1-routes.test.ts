const { test }: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');

const {
  buildTeamSyncUsageResponse,
  hashTeamSyncApiKey,
  validateChatPayload,
  validateTeamSyncApiKey,
  validateTranscribeHandshake,
} = require('../../backend/src/routes/v1') as typeof import('../../backend/src/routes/v1');

const repoRoot = path.resolve(__dirname, '..', '..');

export {};

function readRepoFile(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('backend v1 validates TeamSync API keys without accepting empty keys', () => {
  assert.equal(validateTeamSyncApiKey('').ok, false);
  assert.equal(validateTeamSyncApiKey('short').ok, false);
  assert.deepEqual(validateTeamSyncApiKey('teamsync_api_valid').ok, true);
  assert.equal(hashTeamSyncApiKey('teamsync_api_valid').length, 64);
});

test('backend v1 validates Electron chat payload contract', () => {
  const valid = validateChatPayload({
    messages: [{ role: 'user', content: 'Summarize this meeting.' }],
    stream: true,
    fast_mode: true,
    max_tokens: 1024,
    language: 'English',
  });

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.stream, true);
    assert.equal(valid.value.fast_mode, true);
    assert.equal(valid.value.max_tokens, 1024);
  }

  const invalid = validateChatPayload({ messages: [] });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.status, 400);
  }
});

test('backend v1 validates Electron transcribe websocket auth frame', () => {
  const valid = validateTranscribeHandshake({
    key: 'teamsync_api_valid',
    sample_rate: 16000,
    language: 'auto',
    language_alternates: ['en-US'],
    audio_channels: 1,
    channel: 'mic',
  });

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.sample_rate, 16000);
    assert.equal(valid.value.language, 'auto');
    assert.deepEqual(valid.value.language_alternates, ['en-US']);
  }

  const invalid = validateTranscribeHandshake({
    key: 'teamsync_api_valid',
    sample_rate: 4000,
    audio_channels: 1,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.status, 400);
  }
});

test('backend v1 usage response matches existing Electron settings shape', () => {
  const response = buildTeamSyncUsageResponse(
    {
      plan: 'standard',
      aiRequests: 7,
      sttSeconds: 125,
      searchRequests: 2,
      resetsAt: new Date('2026-07-01T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    {
      aiRequests: 1000,
      sttMinutes: 600,
      searchRequests: 100,
    }
  );

  assert.equal(response.plan, 'standard');
  assert.equal(response.quota.ai.used, 7);
  assert.equal(response.quota.transcription.used, 3);
  assert.equal(response.quota.search.remaining, 98);
  assert.equal(response.quota.resets_at, '2026-07-01T00:00:00.000Z');
  assert.equal(response.member_since, '2026-06-01T00:00:00.000Z');
});

test('backend server registers v1 http and websocket routes', () => {
  const server = readRepoFile('backend/src/server.ts');
  const v1 = readRepoFile('backend/src/routes/v1.ts');

  assert.match(server, /app\.use\('\/v1', createV1Router\(\)\)/);
  assert.match(server, /attachV1WebSocketServer\(server\)/);
  assert.match(v1, /router\.get\('\/usage'/);
  assert.match(v1, /router\.post\('\/chat'/);
  assert.match(v1, /pathname !== '\/v1\/transcribe'/);
  assert.match(v1, /router\.get\('\/health'/);
});
