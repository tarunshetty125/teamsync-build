// electron/intelligence/capability/CapabilityResolver.ts
// Helper utilities for capability-guarded execution.
//
// Provides safe wrappers that run code only when the required capability
// is enabled, with automatic fallback when disabled.
//
// Usage:
//   const result = withCapability('adaptiveMode', () => predict(text), null);

import type { IntelligenceCapabilityKey } from './types';
import { CapabilityRegistry } from './CapabilityRegistry';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Assert that a capability is enabled. Throws if disabled.
 * Use this when the caller MUST have the capability to proceed.
 */
export function assertCapability(key: IntelligenceCapabilityKey): void {
    if (!CapabilityRegistry.getInstance().isEnabled(key)) {
        throw new Error(`[CapabilityResolver] Capability '${key}' is not enabled`);
    }
}

/**
 * Check if a capability is enabled, logging when blocked.
 * Returns the enabled state. Use for soft gates.
 */
export function guardCapability(key: IntelligenceCapabilityKey): boolean {
    const enabled = CapabilityRegistry.getInstance().isEnabled(key);
    if (!enabled) {
        console.log(`[CapabilityResolver] Blocked: '${key}' is disabled`);
    }
    return enabled;
}

// ---------------------------------------------------------------------------
// Safe Execution Wrappers
// ---------------------------------------------------------------------------

/**
 * Run `fn` if the capability is enabled, otherwise return `fallback`.
 * Never throws from capability check — only from `fn` itself.
 */
export function withCapability<T>(
    key: IntelligenceCapabilityKey,
    fn: () => T,
    fallback: T,
): T {
    try {
        if (!CapabilityRegistry.getInstance().isEnabled(key)) {
            return fallback;
        }
        return fn();
    } catch {
        return fallback;
    }
}

/**
 * Async variant of `withCapability`.
 */
export async function withCapabilityAsync<T>(
    key: IntelligenceCapabilityKey,
    fn: () => Promise<T>,
    fallback: T,
): Promise<T> {
    try {
        if (!CapabilityRegistry.getInstance().isEnabled(key)) {
            return fallback;
        }
        return await fn();
    } catch {
        return fallback;
    }
}
