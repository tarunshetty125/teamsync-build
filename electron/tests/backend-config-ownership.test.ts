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

test('Electron no longer owns or launches the hosted backend', () => {
    assert.equal(fs.existsSync(path.join(root, 'electron/services/BackendManager.ts')), false);

    const main = read('electron/main.ts');
    assert.doesNotMatch(main, /BackendManager/);
    assert.doesNotMatch(main, /backend\/dist\/server/);
    assert.match(main, /Backend services are hosted separately/);
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

test('legacy CalendarManager local OAuth path is removed', () => {
    assert.equal(fs.existsSync(path.join(root, 'electron/services/CalendarManager.ts')), false);

    const main = read('electron/main.ts');
    const preload = read('electron/preload.ts');
    const ipc = read('electron/ipcHandlers.ts');

    assert.doesNotMatch(main, /CalendarManager/);
    assert.doesNotMatch(preload, /calendar-connect|get-calendar-status|get-upcoming-events|calendar-refresh/);
    assert.doesNotMatch(ipc, /CalendarManager|calendar-connect|get-calendar-status|get-upcoming-events|calendar-refresh/);
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
