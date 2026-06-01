import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    loadBackendConfig,
    REQUIRED_BACKEND_ENV_KEYS,
} from '../../backend/src/config/env.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('BackendManager only passes non-secret backend runtime launch values', () => {
    const manager = read('electron/services/BackendManager.ts');

    assert.doesNotMatch(manager, /CredentialsManager/);
    assert.doesNotMatch(manager, /buildBackendEnv/);
    assert.doesNotMatch(manager, /ensureCredentials/);
    assert.doesNotMatch(manager, /\.\.\.process\.env/);

    for (const key of REQUIRED_BACKEND_ENV_KEYS) {
        assert.doesNotMatch(manager, new RegExp(`${key}\\s*:`));
    }

    assert.match(manager, /PORT: String\(BACKEND_PORT\)/);
    assert.match(manager, /NODE_ENV: 'production'/);
    assert.match(manager, /NODE_PATH: backendNodeModules/);
});

test('CredentialsManager keeps provider credentials but not backend-owned secrets', () => {
    const credentialsManager = read('electron/services/CredentialsManager.ts');

    for (const retained of [
        'openaiApiKey',
        'groqApiKey',
        'geminiApiKey',
        'claudeApiKey',
        'tavilyApiKey',
        'teamsyncApiKey',
        'sttProvider',
        'customProviders',
    ]) {
        assert.match(credentialsManager, new RegExp(retained));
    }

    assert.doesNotMatch(credentialsManager, /backendMongodbUri\?:/);
    assert.doesNotMatch(credentialsManager, /backendMongodbDbName\?:/);
    assert.doesNotMatch(credentialsManager, /backendGoogleClientId\?:/);
    assert.doesNotMatch(credentialsManager, /backendGoogleClientSecret\?:/);
    assert.doesNotMatch(credentialsManager, /backendJwtSecret\?:/);
    assert.doesNotMatch(credentialsManager, /backendRedirectUri\?:/);
    assert.doesNotMatch(credentialsManager, /getBackendMongodbUri/);
    assert.doesNotMatch(credentialsManager, /seedBackendCredentials/);
    assert.doesNotMatch(credentialsManager, /hasBackendCredentials/);
    assert.doesNotMatch(credentialsManager, /BACKEND_DEFAULTS/);
    assert.match(credentialsManager, /stripLegacyBackendCredentials/);
});

test('backendDefaults module is removed from Electron ownership', () => {
    assert.equal(fs.existsSync(path.join(root, 'electron/config/backendDefaults.ts')), false);
});

test('LicenseManager no longer owns MongoDB license secrets', () => {
    const licenseManager = read('premium/electron/services/LicenseManager.ts');

    assert.doesNotMatch(licenseManager, /from 'mongodb'/);
    assert.doesNotMatch(licenseManager, /MongoClient/);
    assert.doesNotMatch(licenseManager, /MONGODB_URI/);
    assert.doesNotMatch(licenseManager, /MONGODB_DB_NAME/);
    assert.doesNotMatch(licenseManager, /verifyMongoLicense/);
});

test('legacy CalendarManager does not own Google OAuth backend configuration', () => {
    const calendarManager = read('electron/services/CalendarManager.ts');

    assert.doesNotMatch(calendarManager, /process\.env\.GOOGLE_CLIENT_ID/);
    assert.doesNotMatch(calendarManager, /process\.env\.GOOGLE_CLIENT_SECRET/);
    assert.doesNotMatch(calendarManager, /client_secret: GOOGLE_CLIENT_SECRET/);
    assert.doesNotMatch(calendarManager, /REDIRECT_URI =/);
    assert.match(calendarManager, /Legacy Electron calendar OAuth is disabled/);
});

test('backend config validates required secrets and applies non-secret fallbacks', () => {
    assert.throws(
        () => loadBackendConfig({}),
        /Missing required backend environment variable\(s\): MONGODB_URI, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, REDIRECT_URI/
    );

    const config = loadBackendConfig({
        MONGODB_URI: 'mongodb://localhost:27017/test',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        JWT_SECRET: 'jwt-secret',
        REDIRECT_URI: 'http://localhost:3456/auth/google/callback',
    });

    assert.equal(config.mongodbUri, 'mongodb://localhost:27017/test');
    assert.equal(config.mongodbDbName, 'natively');
    assert.equal(config.port, 3456);
    assert.equal(config.nodeEnv, 'development');

    const explicit = loadBackendConfig({
        MONGODB_URI: 'mongodb://localhost:27017/test',
        MONGODB_DB_NAME: 'customdb',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        JWT_SECRET: 'jwt-secret',
        REDIRECT_URI: 'http://localhost:3456/auth/google/callback',
        PORT: '4567',
        NODE_ENV: 'production',
    });

    assert.equal(explicit.mongodbDbName, 'customdb');
    assert.equal(explicit.port, 4567);
    assert.equal(explicit.nodeEnv, 'production');

    assert.throws(
        () => loadBackendConfig({
            MONGODB_URI: 'mongodb://localhost:27017/test',
            GOOGLE_CLIENT_ID: 'client-id',
            GOOGLE_CLIENT_SECRET: 'client-secret',
            JWT_SECRET: 'jwt-secret',
            REDIRECT_URI: 'http://localhost:3456/auth/google/callback',
            PORT: 'not-a-port',
        }),
        /Invalid backend PORT: not-a-port/
    );
});

test('JWT fallback secret is removed from backend auth flow', () => {
    const googleAuth = read('backend/src/services/googleAuth.ts');

    assert.doesNotMatch(googleAuth, /fallback_secret/);
    assert.match(googleAuth, /getBackendConfig\(\)\.jwtSecret/);
});
