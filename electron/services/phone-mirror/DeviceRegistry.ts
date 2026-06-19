/**
 * DeviceRegistry.ts
 * Tracks connected Phone Mirror devices in memory.
 * Provides heartbeat-based stale device cleanup.
 */

import type { ConnectedDevice } from './PhoneMirrorTypes';
import { PHONE_MIRROR_STALE_TIMEOUT_MS, PHONE_MIRROR_STALE_CHECK_INTERVAL_MS } from './PhoneMirrorTypes';

export class DeviceRegistry {
    private devices = new Map<string, ConnectedDevice>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * Register a new connected device.
     */
    registerDevice(id: string, name: string): ConnectedDevice {
        const now = Date.now();
        const device: ConnectedDevice = {
            id,
            name,
            connectedAt: now,
            lastHeartbeat: now,
        };
        this.devices.set(id, device);
        console.log(`[PhoneMirror] Device registered: ${name} (${id})`);
        return device;
    }

    /**
     * Remove a device by ID.
     */
    removeDevice(id: string): boolean {
        const device = this.devices.get(id);
        if (device) {
            this.devices.delete(id);
            console.log(`[PhoneMirror] Device removed: ${device.name} (${id})`);
            return true;
        }
        return false;
    }

    /**
     * Update a device's last heartbeat timestamp.
     */
    updateHeartbeat(id: string): void {
        const device = this.devices.get(id);
        if (device) {
            device.lastHeartbeat = Date.now();
        }
    }

    /**
     * Get all currently connected devices.
     */
    getDevices(): ConnectedDevice[] {
        return Array.from(this.devices.values());
    }

    /**
     * Get the count of connected devices.
     */
    getDeviceCount(): number {
        return this.devices.size;
    }

    /**
     * Remove devices whose heartbeat is older than the timeout threshold.
     * Returns the IDs of removed devices.
     */
    cleanupStaleDevices(timeoutMs: number = PHONE_MIRROR_STALE_TIMEOUT_MS): string[] {
        const now = Date.now();
        const staleIds: string[] = [];

        for (const [id, device] of this.devices.entries()) {
            if (now - device.lastHeartbeat > timeoutMs) {
                staleIds.push(id);
            }
        }

        for (const id of staleIds) {
            const device = this.devices.get(id);
            console.log(`[PhoneMirror] Removing stale device: ${device?.name || id}`);
            this.devices.delete(id);
        }

        return staleIds;
    }

    /**
     * Start the periodic stale device cleanup timer.
     */
    startCleanupTimer(): void {
        this.stopCleanupTimer();
        this.cleanupTimer = setInterval(() => {
            this.cleanupStaleDevices();
        }, PHONE_MIRROR_STALE_CHECK_INTERVAL_MS);
    }

    /**
     * Stop the periodic stale device cleanup timer.
     */
    stopCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Remove all devices and stop cleanup.
     */
    clear(): void {
        this.devices.clear();
        this.stopCleanupTimer();
    }
}
