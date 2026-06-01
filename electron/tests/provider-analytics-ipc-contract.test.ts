import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Sprint 8 Phase F centralizes provider analytics IPC channel constants', () => {
    const helper = read('src/lib/providers/providerAnalyticsSessionSnapshot.ts');
    const ipcHandlers = read('electron/ipcHandlers.ts');
    const preload = read('electron/preload.ts');

    assert.deepEqual(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC, {
        set: 'provider-analytics:set-session-snapshot',
        get: 'provider-analytics:get-session-snapshot',
        changed: 'provider-analytics:session-snapshot-changed',
    });
    assert.match(helper, /export const PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC/);
    assert.match(ipcHandlers, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.set/);
    assert.match(ipcHandlers, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.get/);
    assert.match(ipcHandlers, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.changed/);
    assert.match(preload, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.set/);
    assert.match(preload, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.get/);
    assert.match(preload, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.changed/);
});

test('Sprint 8 Phase F shares provider analytics bridge types across preload and renderer declarations', () => {
    const helper = read('src/lib/providers/providerAnalyticsSessionSnapshot.ts');
    const preload = read('electron/preload.ts');
    const electronTypes = read('src/types/electron.d.ts');

    assert.match(helper, /export interface ProviderAnalyticsSessionSnapshotBridge/);
    assert.match(helper, /export interface ProviderAnalyticsSessionSnapshotSetResult/);
    assert.match(preload, /interface ElectronAPI extends ProviderAnalyticsSessionSnapshotBridge/);
    assert.match(electronTypes, /export interface ElectronAPI extends ProviderAnalyticsSessionSnapshotBridge/);
    assert.doesNotMatch(preload, /setProviderAnalyticsSessionSnapshot: \(snapshot: ProviderAnalyticsSessionSnapshot \| null\) => Promise<\{ success: boolean \}>/);
    assert.doesNotMatch(electronTypes, /setProviderAnalyticsSessionSnapshot: \(snapshot: ProviderAnalyticsSessionSnapshot \| null\) => Promise<\{ success: boolean \}>/);
});

test('Sprint 8 Phase F keeps provider analytics IPC memory-only and side-effect free', () => {
    const ipcHandlers = read('electron/ipcHandlers.ts');
    const relayStart = ipcHandlers.indexOf('PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.set');
    const relayEnd = ipcHandlers.indexOf('safeHandle(SESSION_EXPORT_DELIVERY_IPC.save');
    assert.notEqual(relayStart, -1);
    assert.notEqual(relayEnd, -1);
    const relayBody = ipcHandlers.slice(relayStart, relayEnd);

    assert.match(relayBody, /applyProviderAnalyticsSessionSnapshotQuarantine/);
    assert.match(relayBody, /providerAnalyticsSessionSnapshot = quarantine\.currentSnapshot/);
    assert.match(relayBody, /if \(quarantine\.shouldBroadcast\)/);
    assert.match(relayBody, /broadcastProviderAnalyticsSessionSnapshot/);
    assert.doesNotMatch(relayBody, /CredentialsManager|DatabaseManager|BenchmarkManager|writeFile|localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(relayBody, /resolveRoutingDecision|setDefaultModel|setProviderPreferredModel|setModel/);
});
