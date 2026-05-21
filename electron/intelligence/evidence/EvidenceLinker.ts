// electron/intelligence/evidence/EvidenceLinker.ts
// Links claims to supporting evidence and computes support strength.
//
// Pure functions — no state, no side effects.
//
// Usage:
//   const chain = linkEvidence('Candidate showed strong ownership', evidenceItems);
//   // chain.supportStrength → 0.75

import type { Evidence, EvidenceChain } from './types';

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Create an evidence chain linking a claim to its supporting evidence.
 *
 * Support strength formula:
 *   base = sum of evidence confidences
 *   coverage = min(1.0, evidence.length / 3) — 3+ items = full coverage
 *   supportStrength = min(1.0, base * coverage)
 */
export function linkEvidence(claim: string, evidence: readonly Evidence[]): EvidenceChain {
    return {
        claim,
        evidence,
        supportStrength: computeSupportStrength(evidence),
    };
}

/**
 * Merge evidence chains that have overlapping evidence.
 *
 * Two chains are merged if they share at least one evidence item
 * (matched by quote similarity — exact match after lowercasing/trimming).
 * The merged chain takes the claim from the first chain.
 */
export function mergeEvidenceChains(chains: readonly EvidenceChain[]): EvidenceChain[] {
    if (chains.length <= 1) return [...chains];

    const merged: EvidenceChain[] = [];
    const consumed = new Set<number>();

    for (let i = 0; i < chains.length; i++) {
        if (consumed.has(i)) continue;

        let currentEvidence = [...chains[i].evidence];
        const currentClaim = chains[i].claim;

        for (let j = i + 1; j < chains.length; j++) {
            if (consumed.has(j)) continue;

            const overlap = hasOverlappingEvidence(currentEvidence, chains[j].evidence);
            if (overlap) {
                consumed.add(j);
                // Merge evidence, deduplicating by normalized quote
                currentEvidence = deduplicateEvidence([
                    ...currentEvidence,
                    ...chains[j].evidence,
                ]);
            }
        }

        merged.push({
            claim: currentClaim,
            evidence: currentEvidence,
            supportStrength: computeSupportStrength(currentEvidence),
        });
    }

    return merged;
}

/**
 * Compute support strength from a set of evidence items.
 *
 * Support = min(1.0, avg(confidences) × coverage_factor)
 * Coverage factor = min(1.0, evidence_count / 3)
 */
export function computeSupportStrength(evidence: readonly Evidence[]): number {
    if (evidence.length === 0) return 0;

    const avgConfidence = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length;
    const coverageFactor = Math.min(1.0, evidence.length / 3);

    return Math.min(1.0, avgConfidence * coverageFactor);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if two evidence sets share at least one overlapping item.
 */
function hasOverlappingEvidence(
    a: readonly Evidence[],
    b: readonly Evidence[],
): boolean {
    const normalizedA = new Set(a.map(e => normalizeQuote(e.quote)));
    return b.some(e => normalizedA.has(normalizeQuote(e.quote)));
}

/**
 * Deduplicate evidence items by normalized quote text.
 * Keeps the first occurrence (higher confidence wins since inputs are pre-sorted).
 */
function deduplicateEvidence(evidence: readonly Evidence[]): Evidence[] {
    const seen = new Set<string>();
    const result: Evidence[] = [];

    for (const item of evidence) {
        const key = normalizeQuote(item.quote);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
        }
    }

    return result;
}

/**
 * Normalize a quote for deduplication comparison.
 */
function normalizeQuote(quote: string): string {
    return quote.trim().toLowerCase().replace(/\s+/g, ' ');
}
