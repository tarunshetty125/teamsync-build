import type { ProfilePolicy, TranscriptStrategy, UnifiedActionIntent } from './ActionContextBuilder';
import type { SessionMode } from './SessionTracker';

export interface ActionMetricsPayload {
    intent: UnifiedActionIntent;
    mode: SessionMode;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheHit: boolean;
    retryCount: number;
    fallbackUsed: boolean;
    profileUsed: boolean;
    profilePolicy: ProfilePolicy;
    transcriptStrategy: TranscriptStrategy;
    requestId?: string | null;
}

export function logActionMetrics(payload: ActionMetricsPayload): void {
    console.log('[ActionMetrics]', JSON.stringify(payload));
}
