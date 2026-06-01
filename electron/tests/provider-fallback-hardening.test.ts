import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    buildProviderFallbackCandidatePlan,
    evaluateProviderFallbackCandidate,
    formatProviderFallbackCandidateSkipReason,
    type ProviderFallbackCandidate,
} from '../../src/lib/providers/providerFallbackCandidatePolicy.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function extractBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1);
    return source.slice(startIndex, endIndex);
}

function candidate(provider: string): ProviderFallbackCandidate {
    return {
        provider,
        model: `${provider}-model`,
    };
}

test('Sprint 14 Phase E attempts healthy fallback candidates', () => {
    const evaluation = evaluateProviderFallbackCandidate(candidate('openai'), {
        configured: true,
        reachable: true,
        authenticated: true,
        degraded: false,
        lastDiagnostic: {
            category: 'ok',
            message: 'OpenAI is healthy.',
        },
    });

    assert.equal(evaluation.decision, 'attempt');
    assert.equal(evaluation.skipReason, undefined);
    assert.equal(evaluation.knownHealth, true);
});

test('Sprint 14 Phase E skips unconfigured, unreachable, and auth-failed fallback candidates', () => {
    const unconfigured = evaluateProviderFallbackCandidate(candidate('claude'), {
        configured: false,
        reachable: false,
        authenticated: false,
        degraded: false,
        lastDiagnostic: {
            category: 'not_configured',
            message: 'Claude is not configured.',
        },
    });
    const unreachable = evaluateProviderFallbackCandidate(candidate('ollama'), {
        configured: true,
        reachable: false,
        authenticated: true,
        degraded: true,
        lastDiagnostic: {
            category: 'ollama_unavailable',
            message: 'Ollama is not reachable.',
        },
    });
    const authFailed = evaluateProviderFallbackCandidate(candidate('groq'), {
        configured: true,
        reachable: false,
        authenticated: false,
        degraded: true,
        lastDiagnostic: {
            category: 'invalid_keys',
            message: 'Groq keys are invalid.',
        },
    });

    assert.equal(unconfigured.decision, 'skip');
    assert.equal(unconfigured.skipReason, 'not_configured');
    assert.equal(unreachable.decision, 'skip');
    assert.equal(unreachable.skipReason, 'unreachable');
    assert.equal(authFailed.decision, 'skip');
    assert.equal(authFailed.skipReason, 'auth_failed');
});

test('Sprint 14 Phase E still allows degraded and unknown fallback candidates', () => {
    const degraded = evaluateProviderFallbackCandidate(candidate('groq'), {
        configured: true,
        reachable: true,
        authenticated: true,
        degraded: true,
        lastDiagnostic: {
            category: 'cooldown',
            message: 'Some Groq keys are cooling down.',
        },
    });
    const unknown = evaluateProviderFallbackCandidate(candidate('custom'));

    assert.equal(degraded.decision, 'attempt');
    assert.equal(degraded.degraded, true);
    assert.equal(unknown.decision, 'attempt');
    assert.equal(unknown.knownHealth, false);
});

test('Sprint 14 Phase E selects the next viable fallback candidate after known-bad candidates', () => {
    const candidates = [candidate('claude'), candidate('openai'), candidate('gemini')];
    const plan = buildProviderFallbackCandidatePlan(candidates, {
        claude: {
            configured: false,
            reachable: false,
            authenticated: false,
            degraded: false,
            lastDiagnostic: {
                category: 'not_configured',
                message: 'Claude is not configured.',
            },
        },
        openai: {
            configured: true,
            reachable: false,
            authenticated: false,
            degraded: true,
            lastDiagnostic: {
                category: 'auth_failed',
                message: 'OpenAI credentials failed.',
            },
        },
        gemini: {
            configured: true,
            reachable: true,
            authenticated: true,
            degraded: false,
            lastDiagnostic: {
                category: 'configured',
                message: 'Gemini is configured.',
            },
        },
    });

    assert.equal(plan.selectedCandidate?.provider, 'gemini');
    assert.deepEqual(plan.skippedCandidates.map((entry) => entry.skipReason), ['not_configured', 'auth_failed']);
});

test('Sprint 14 Phase E leaves safe local fallback reachable when all candidates are skipped', () => {
    const plan = buildProviderFallbackCandidatePlan([candidate('openai'), candidate('groq')], {
        openai: {
            configured: false,
            reachable: false,
            authenticated: false,
            degraded: false,
            lastDiagnostic: {
                category: 'not_configured',
                message: 'OpenAI is not configured.',
            },
        },
        groq: {
            configured: true,
            reachable: false,
            authenticated: false,
            degraded: true,
            lastDiagnostic: {
                category: 'invalid_keys',
                message: 'Groq keys are invalid.',
            },
        },
    });

    assert.equal(plan.selectedCandidate, null);
    assert.equal(plan.skippedCandidates.length, 2);
});

test('Sprint 14 Phase E preserves fallback metadata for skipped candidates', () => {
    const evaluation = evaluateProviderFallbackCandidate(candidate('bedrock'), {
        configured: true,
        reachable: false,
        authenticated: false,
        degraded: true,
        lastDiagnostic: {
            category: 'auth_expired',
            message: 'AWS session expired.',
        },
    });
    const reason = formatProviderFallbackCandidateSkipReason(evaluation);

    assert.equal(evaluation.decision, 'skip');
    assert.match(reason, /fallback_candidate_skipped/);
    assert.match(reason, /auth_failed/);
    assert.match(reason, /provider=bedrock/);
    assert.match(reason, /diagnostic=auth_expired/);
});

test('Sprint 14 Phase E wires fallback candidate hardening without changing ownership or safe fallback routing', () => {
    const engine = read('electron/IntelligenceEngine.ts');
    const retryBody = extractBetween(
        engine,
        'private async executeActionWithRetry',
        'private async ensureValidActionOutput',
    );

    assert.match(engine, /buildProviderFallbackCandidatePlan/);
    assert.match(engine, /formatProviderFallbackCandidateSkipReason/);
    assert.match(engine, /buildFallbackCandidateHealthSignals/);
    assert.match(engine, /resolveFallbackCandidates/);
    assert.match(retryBody, /fallbackPlan\.selectedCandidate\?\.model/);
    assert.match(retryBody, /recordSkippedFallbackCandidates/);
    assert.match(retryBody, /result: 'skipped'/);
    assert.match(retryBody, /routingForOwnership/);
    assert.match(retryBody, /BEDROCK_AUTH_EXPIRED_ROUTING_REASON/);
    assert.match(retryBody, /actualModel: 'safe_action_fallback'/);
    assert.match(retryBody, /actualProvider: 'local'/);
    assert.match(retryBody, /fallbackChain/);
    assert.doesNotMatch(retryBody, /testConnection|fetch\(|resolveRoutingDecision\(\{\s*requestedModel: evaluation/s);
});
