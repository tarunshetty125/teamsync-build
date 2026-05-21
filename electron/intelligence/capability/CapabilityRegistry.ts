// electron/intelligence/capability/CapabilityRegistry.ts
// Centralized gating for NEW intelligence features.
//
// Reads from the existing LicenseManager to determine premium state.
// Provides runtime kill switches and feature flags for safe rollout.
// Does NOT modify or replace any existing license checks.
//
// Usage:
//   const registry = CapabilityRegistry.getInstance();
//   if (registry.isEnabled('adaptiveMode')) { /* ... */ }

import type {
    IntelligenceCapabilityKey,
    IntelligenceCapabilitySet,
    CapabilityChangeEvent,
    CapabilityConfig,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_CAPABILITY_KEYS: readonly IntelligenceCapabilityKey[] = [
    'adaptiveMode',
    'adaptiveModeUI',
    'multiBrain',
    'timeline',
    'timelineUI',
    'confidenceEngine',
    'evidenceLayer',
    'modeMemory',
    'explainability',
    'explainabilityUI',
    'multiBrainTelemetry',
    // Phase 6
    'predictorV2',
    'brainQualityScoring',
    'promptOptimization',
    'latencyOptimization',
] as const;

const DEFAULT_CONFIG: CapabilityConfig = {
    killSwitches: {},
    featureFlags: {
        // All flags OFF by default — must be explicitly enabled for rollout
        adaptiveMode: false,
        adaptiveModeUI: false,
        multiBrain: false,
        timeline: false,
        timelineUI: false,
        confidenceEngine: false,
        evidenceLayer: false,
        modeMemory: false,
        explainability: false,
        explainabilityUI: false,
        multiBrainTelemetry: false,
        // Phase 6
        predictorV2: false,
        brainQualityScoring: false,
        promptOptimization: false,
        latencyOptimization: false,
    },
    requiresPremium: {
        adaptiveMode: true,
        adaptiveModeUI: true,
        multiBrain: true,
        timeline: true,
        timelineUI: true,
        confidenceEngine: true,
        evidenceLayer: true,
        modeMemory: true,
        explainability: true,
        explainabilityUI: true,
        multiBrainTelemetry: true,
        // Phase 6
        predictorV2: true,
        brainQualityScoring: true,
        promptOptimization: true,
        latencyOptimization: true,
    },
};

// ---------------------------------------------------------------------------
// CapabilityRegistry
// ---------------------------------------------------------------------------

type ChangeListener = (event: CapabilityChangeEvent) => void;

export class CapabilityRegistry {
    private static instance: CapabilityRegistry;

    private killSwitches: Map<IntelligenceCapabilityKey, boolean>;
    private featureFlags: Map<IntelligenceCapabilityKey, boolean>;
    private requiresPremium: Map<IntelligenceCapabilityKey, boolean>;
    private listeners: Set<ChangeListener> = new Set();

    // Cache license state to avoid repeated cross-module calls
    private cachedPremiumState: boolean | null = null;
    private lastLicenseCheckAt: number = 0;
    private static readonly LICENSE_CACHE_TTL_MS = 5_000; // 5 seconds

    private constructor() {
        this.killSwitches = new Map();
        this.featureFlags = new Map();
        this.requiresPremium = new Map();
        this.applyConfig(DEFAULT_CONFIG);
    }

    static getInstance(): CapabilityRegistry {
        if (!CapabilityRegistry.instance) {
            CapabilityRegistry.instance = new CapabilityRegistry();
        }
        return CapabilityRegistry.instance;
    }

    // ---------------------------------------------------------------------------
    // Core API
    // ---------------------------------------------------------------------------

    /**
     * Check if a capability is enabled.
     * Returns false if:
     *   1. Kill switch is ON for this key
     *   2. Feature flag is OFF for this key
     *   3. Premium is required AND user is not premium
     */
    isEnabled(key: IntelligenceCapabilityKey): boolean {
        // Kill switch takes absolute precedence
        if (this.killSwitches.get(key) === true) {
            return false;
        }

        // Feature flag must be ON
        if (this.featureFlags.get(key) === false) {
            return false;
        }

        // Premium gate
        if (this.requiresPremium.get(key) === true && !this.isPremiumLicense()) {
            return false;
        }

        return true;
    }

    /**
     * Get a snapshot of all capabilities.
     */
    getCapabilities(): IntelligenceCapabilitySet {
        const result: Record<string, boolean> = {};
        for (const key of ALL_CAPABILITY_KEYS) {
            result[key] = this.isEnabled(key);
        }
        return result as IntelligenceCapabilitySet;
    }

    // ---------------------------------------------------------------------------
    // Runtime Controls
    // ---------------------------------------------------------------------------

    /**
     * Set a kill switch at runtime. No restart required.
     * When killed=true, the capability is DISABLED regardless of everything else.
     */
    setKillSwitch(key: IntelligenceCapabilityKey, killed: boolean): void {
        const wasBefore = this.isEnabled(key);
        this.killSwitches.set(key, killed);
        const isAfter = this.isEnabled(key);

        if (wasBefore !== isAfter) {
            this.emitChange(key, isAfter, 'kill_switch');
        }
    }

    /**
     * Set a feature flag at runtime. No restart required.
     */
    setFeatureFlag(key: IntelligenceCapabilityKey, enabled: boolean): void {
        const wasBefore = this.isEnabled(key);
        this.featureFlags.set(key, enabled);
        const isAfter = this.isEnabled(key);

        if (wasBefore !== isAfter) {
            this.emitChange(key, isAfter, 'config_change');
        }
    }

    /**
     * Bulk update configuration.
     */
    updateConfig(config: Partial<CapabilityConfig>): void {
        const before = this.getCapabilities();
        this.applyConfig(config);
        const after = this.getCapabilities();

        // Emit changes for any capability that toggled
        for (const key of ALL_CAPABILITY_KEYS) {
            if (before[key] !== after[key]) {
                this.emitChange(key, after[key], 'config_change');
            }
        }
    }

    /**
     * Re-evaluate all capabilities after a license change.
     * Call this from license activation/deactivation handlers.
     */
    refreshLicenseState(): void {
        // Invalidate cache
        this.cachedPremiumState = null;
        this.lastLicenseCheckAt = 0;

        const before = this.getCapabilities();
        // Force fresh license check
        this.isPremiumLicense();
        const after = this.getCapabilities();

        for (const key of ALL_CAPABILITY_KEYS) {
            if (before[key] !== after[key]) {
                this.emitChange(key, after[key], 'license_change');
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Change Subscription
    // ---------------------------------------------------------------------------

    /**
     * Subscribe to capability changes. Returns unsubscribe function.
     */
    onChange(callback: ChangeListener): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    /**
     * Check premium license state via LicenseManager.
     * Uses dynamic require to avoid circular dependencies.
     * Caches result for 5 seconds to avoid repeated cross-module calls.
     */
    private isPremiumLicense(): boolean {
        const now = Date.now();
        if (
            this.cachedPremiumState !== null &&
            now - this.lastLicenseCheckAt < CapabilityRegistry.LICENSE_CACHE_TTL_MS
        ) {
            return this.cachedPremiumState;
        }

        try {
            // Dynamic require to avoid top-level import circular deps
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { LicenseManager } = require('../../../premium/electron/services/LicenseManager');
            this.cachedPremiumState = LicenseManager.getInstance().isPremium();
        } catch {
            // LicenseManager not available (open-source build, test env, etc.)
            this.cachedPremiumState = false;
        }

        this.lastLicenseCheckAt = now;
        return this.cachedPremiumState;
    }

    private applyConfig(config: Partial<CapabilityConfig>): void {
        if (config.killSwitches) {
            for (const [key, value] of Object.entries(config.killSwitches)) {
                if (value !== undefined) {
                    this.killSwitches.set(key as IntelligenceCapabilityKey, value);
                }
            }
        }
        if (config.featureFlags) {
            for (const [key, value] of Object.entries(config.featureFlags)) {
                if (value !== undefined) {
                    this.featureFlags.set(key as IntelligenceCapabilityKey, value);
                }
            }
        }
        if (config.requiresPremium) {
            for (const [key, value] of Object.entries(config.requiresPremium)) {
                if (value !== undefined) {
                    this.requiresPremium.set(key as IntelligenceCapabilityKey, value);
                }
            }
        }
    }

    private emitChange(
        key: IntelligenceCapabilityKey,
        enabled: boolean,
        reason: CapabilityChangeEvent['reason']
    ): void {
        const event: CapabilityChangeEvent = {
            key,
            enabled,
            reason,
            timestamp: Date.now(),
        };

        console.log(`[CapabilityRegistry] ${key}: ${enabled} (reason: ${reason})`);

        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (err) {
                console.warn('[CapabilityRegistry] Listener error:', err);
            }
        }
    }
}
