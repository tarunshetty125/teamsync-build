import type { ProfilePolicy, TranscriptStrategy, UnifiedActionIntent } from './ActionContextBuilder';
import type { SessionMode } from './SessionTracker';
import { emitPromptAudit } from './ActionTelemetry';

export interface PromptDebugPayload {
    requestId?: string | null;
    intent: UnifiedActionIntent;
    mode: SessionMode;
    transcriptStrategy: TranscriptStrategy;
    transcriptLength: number;
    transcriptApproxTokens: number;
    profileUsed: boolean;
    profilePolicy: ProfilePolicy;
    finalPrompt: string;
}

export function logPrompt(payload: PromptDebugPayload): void {
    emitPromptAudit({
        requestId: payload.requestId ?? 'untracked',
        actionType: payload.intent,
        promptTokens: payload.transcriptApproxTokens,
        finalPrompt: payload.finalPrompt,
    });
}
