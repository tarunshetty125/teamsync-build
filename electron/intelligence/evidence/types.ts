// electron/intelligence/evidence/types.ts
// Types for the evidence extraction and linking system.
// IMPORTANT: This file must have ZERO runtime dependencies.

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Source of an evidence item */
export type EvidenceSource = 'transcript' | 'screen' | 'rag' | 'profile';

/**
 * A single piece of evidence extracted from a context source.
 */
export interface Evidence {
    /** Exact text quoted from the source */
    readonly quote: string;
    /** Who said it (speaker label) */
    readonly speaker: string;
    /** When it was said (unix ms) */
    readonly timestamp: number;
    /** How confident we are this is relevant (0–1) */
    readonly confidence: number;
    /** Where this evidence came from */
    readonly source: EvidenceSource;
}

// ---------------------------------------------------------------------------
// Evidence Chain
// ---------------------------------------------------------------------------

/**
 * Links a claim/insight to its supporting evidence.
 */
export interface EvidenceChain {
    /** The claim or insight being supported */
    readonly claim: string;
    /** Supporting evidence items */
    readonly evidence: readonly Evidence[];
    /** Overall support strength (0.0–1.0) */
    readonly supportStrength: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for evidence extraction.
 */
export interface EvidenceExtractionConfig {
    /** Maximum evidence items per extraction (default 5) */
    readonly maxQuotes: number;
    /** Minimum characters for a quote to count (default 10) */
    readonly minQuoteLength: number;
    /** Maximum characters per quote (default 500) */
    readonly maxQuoteLength: number;
    /** Minimum keyword overlap ratio for inclusion (default 0.1) */
    readonly relevanceThreshold: number;
}
