import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    canonicalize,
    EntitlementVerifier,
    type SignedEntitlement,
} from '../licensing/EntitlementVerifier.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function tempCachePath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsync-license-test-'));
    return path.join(dir, 'license-entitlement-cache.json');
}

function keyPair(): { privateKey: string; publicKey: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
}

function signEntitlement(
    privateKey: string,
    overrides: Partial<Omit<SignedEntitlement, 'signature'>> = {},
): SignedEntitlement {
    const unsigned: Omit<SignedEntitlement, 'signature'> = {
        plan: 'pro',
        userId: 'user_123',
        deviceId: 'device_123',
        licenseId: 'lic_123',
        trial: false,
        issuedAt: '2026-06-02T00:00:00.000Z',
        expiresAt: '2026-06-02T00:30:00.000Z',
        graceUntil: '2026-06-05T00:00:00.000Z',
        entitlementVersion: 7,
        features: ['profile_engine', 'job_intelligence'],
        issuer: 'license.teamsync.ai',
        ...overrides,
    };
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalize(unsigned));
    signer.end();
    return {
        ...unsigned,
        signature: signer.sign(privateKey).toString('base64url'),
    };
}

function writeCache(cachePath: string, entitlement: SignedEntitlement, lastSuccessfulSyncAt = '2026-06-02T00:00:00.000Z'): void {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ entitlement, lastSuccessfulSyncAt }, null, 2));
}

test('signed entitlement cache grants premium only with a valid server signature', () => {
    const { privateKey, publicKey } = keyPair();
    const cachePath = tempCachePath();
    const entitlement = signEntitlement(privateKey);
    writeCache(cachePath, entitlement);

    const verifier = new EntitlementVerifier({
        publicKey,
        cachePath,
        deviceId: 'device_123',
        now: () => new Date('2026-06-02T00:05:00.000Z'),
    });

    assert.equal(verifier.getStatus().isPremium, true);
    assert.equal(verifier.getStatus().status, 'active');
    assert.equal(verifier.getStatus().plan, 'pro');

    writeCache(cachePath, { ...entitlement, features: ['tampered_feature'] });
    const tamperedVerifier = new EntitlementVerifier({
        publicKey,
        cachePath,
        deviceId: 'device_123',
        now: () => new Date('2026-06-02T00:05:00.000Z'),
    });

    assert.equal(tamperedVerifier.getStatus().isPremium, false);
    assert.equal(tamperedVerifier.getStatus().status, 'invalid_signature');
});

test('offline premium is allowed only inside the signed 72 hour grace window', () => {
    const { privateKey, publicKey } = keyPair();
    const entitlement = signEntitlement(privateKey, {
        expiresAt: '2026-06-02T00:10:00.000Z',
        graceUntil: '2026-06-05T00:00:00.000Z',
    });

    const graceCachePath = tempCachePath();
    writeCache(graceCachePath, entitlement, '2026-06-02T00:00:00.000Z');
    const graceVerifier = new EntitlementVerifier({
        publicKey,
        cachePath: graceCachePath,
        deviceId: 'device_123',
        now: () => new Date('2026-06-02T00:40:00.000Z'),
    });
    assert.equal(graceVerifier.getStatus().status, 'offline_grace');
    assert.equal(graceVerifier.getStatus().isPremium, true);

    const expiredCachePath = tempCachePath();
    writeCache(expiredCachePath, entitlement, '2026-06-01T23:59:00.000Z');
    const expiredVerifier = new EntitlementVerifier({
        publicKey,
        cachePath: expiredCachePath,
        deviceId: 'device_123',
        now: () => new Date('2026-06-05T00:10:00.000Z'),
    });
    assert.equal(expiredVerifier.getStatus().status, 'expired');
    assert.equal(expiredVerifier.getStatus().isPremium, false);
});

test('legacy premium-localStorage is deleted and never grants authority', async () => {
    const { publicKey } = keyPair();
    const cachePath = tempCachePath();
    const legacyPath = path.join(path.dirname(cachePath), 'premium-localStorage.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ isPremium: true, plan: 'pro' }));

    const verifier = new EntitlementVerifier({
        publicKey,
        cachePath,
        deviceId: 'device_123',
        now: () => new Date('2026-06-02T00:00:00.000Z'),
    });
    const status = await verifier.initialize();
    verifier.stopBackgroundSync();

    assert.equal(status.isPremium, false);
    assert.equal(fs.existsSync(legacyPath), false);
});

test('renderer licensing IPC is reduced to server-authoritative channels', () => {
    const ipcHandlers = read('electron/ipcHandlers.ts');
    const preload = read('electron/preload.ts');

    const handledLicenseChannels = Array.from(ipcHandlers.matchAll(/safeHandle\("([^"]+)"/g))
        .map(match => match[1])
        .filter(channel => channel.startsWith('license:'));

    assert.deepEqual(handledLicenseChannels.sort(), [
        'license:activate',
        'license:deactivate',
        'license:get-entitlement',
        'license:sync',
    ].sort());

    for (const source of [ipcHandlers, preload]) {
        assert.doesNotMatch(source, /license:check-premium/);
        assert.doesNotMatch(source, /license:get-details/);
        assert.doesNotMatch(source, /get_user_plan/);
        assert.doesNotMatch(source, /license:check-premium-async/);
        assert.doesNotMatch(source, /license:get-hardware-id/);
        assert.doesNotMatch(source, /trial:start|trial:status|trial:get-local|trial:convert|trial:end-byok/);
    }

    assert.match(ipcHandlers, /validateLicenseSender/);
    assert.match(ipcHandlers, /rejectUntrustedLicenseSender/);
});

test('legacy native licensing authority is removed from the shipped native surface', () => {
    assert.equal(fs.existsSync(path.join(root, 'native-module/src/license.rs')), false);

    const nativeLoader = read('electron/audio/nativeModuleLoader.ts');
    const nativeTypes = read('native-module/index.d.ts');
    const nativeIndex = read('native-module/index.js');
    const nativeLib = read('native-module/src/lib.rs');

    for (const source of [nativeLoader, nativeTypes, nativeIndex, nativeLib]) {
        assert.doesNotMatch(source, /verifyGumroadKey|verifyDodoKey|validateDodoKey|deactivateDodoKey/);
        assert.doesNotMatch(source, /Gumroad|Dodo Payments|dodopayments/);
    }

    assert.match(nativeLib, /pub mod device/);
});

test('backend exposes complete license authority routes and services', () => {
    const server = read('backend/src/server.ts');
    const routes = read('backend/src/licensing/routes/index.ts');
    const webhooks = read('backend/src/licensing/routes/webhooks.ts');
    const licenseService = read('backend/src/licensing/services/LicenseService.ts');
    const entitlementService = read('backend/src/licensing/services/EntitlementService.ts');
    const signatureService = read('backend/src/licensing/services/SignatureService.ts');
    const deviceService = read('backend/src/licensing/services/DeviceService.ts');
    const trialService = read('backend/src/licensing/services/TrialService.ts');

    assert.match(server, /app\.use\('\/license', licensingRoutes\)/);
    assert.match(server, /app\.use\('\/webhooks', webhookRoutes\)/);

    for (const route of [
        '/activate',
        '/sync',
        '/deactivate',
        '/entitlement',
        '/trial/start',
        '/trial/status',
        '/heartbeat',
    ]) {
        assert.match(routes, new RegExp(route.replace('/', '\\/')));
    }

    assert.match(webhooks, /router\.post\('\/dodo'/);
    assert.match(webhooks, /router\.post\('\/gumroad'/);
    assert.match(webhooks, /router\.post\('\/stripe'/);

    assert.match(licenseService, /subscription_failed/);
    assert.match(licenseService, /device_removed/);
    assert.match(licenseService, /revoked/);
    assert.match(deviceService, /DeviceLimitError/);
    assert.match(deviceService, /activeDeviceCount >= params\.license\.deviceLimit/);
    assert.match(trialService, /issueForTrial/);
    assert.match(entitlementService, /attachSignature/);
    assert.match(signatureService, /LICENSE_PRIVATE_KEY/);
});
