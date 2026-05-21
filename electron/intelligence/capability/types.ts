// electron/intelligence/capability/types.ts
// Types for the capability gating system.
// Gates NEW intelligence features only — does NOT touch existing license checks.
//
// IMPORTANT: This file must have ZERO runtime dependencies.

// ---------------------------------------------------------------------------
// Capability Keys
// ---------------------------------------------------------------------------

/** All new intelligence features that can be gated */
export type IntelligenceCapabilityKey =
    | 'adaptiveMode'
    | 'adaptiveModeUI'
    | 'multiBrain'
    | 'timeline'
    | 'timelineUI'
    | 'confidenceEngine'
    | 'evidenceLayer'
    | 'modeMemory'
    | 'explainability'
    | 'explainabilityUI'
    | 'multiBrainTelemetry';

/** Full capability set snapshot */
export type IntelligenceCapabilitySet = Readonly<Record<IntelligenceCapabilityKey, boolean>>;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Change event emitted when a capability toggles */
export interface CapabilityChangeEvent {
    readonly key: IntelligenceCapabilityKey;
    readonly enabled: boolean;
    readonly reason: 'license_change' | 'config_change' | 'kill_switch' | 'fallback';
    readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for capability defaults and overrides */
export interface CapabilityConfig {
    /** Kill switches — if true, capability is DISABLED regardless of license */
    readonly killSwitches: Partial<Record<IntelligenceCapabilityKey, boolean>>;
    /** Feature flags — if false, capability is DISABLED regardless of license */
    readonly featureFlags: Partial<Record<IntelligenceCapabilityKey, boolean>>;
    /** Whether premium license is required (default: all require premium) */
    readonly requiresPremium: Partial<Record<IntelligenceCapabilityKey, boolean>>;
}
