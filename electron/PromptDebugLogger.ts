import type { ProfilePolicy, TranscriptStrategy, UnifiedActionIntent } from './ActionContextBuilder';
import type { SessionMode } from './SessionTracker';

export interface PromptDebugPayload {
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
    console.log('[PromptDebug] Metadata:', JSON.stringify({
        intent: payload.intent,
        mode: payload.mode,
        transcriptStrategy: payload.transcriptStrategy,
        transcriptLength: payload.transcriptLength,
        transcriptApproxTokens: payload.transcriptApproxTokens,
        profileUsed: payload.profileUsed,
        profilePolicy: payload.profilePolicy,
    }));
    console.log('[PromptDebug] FinalPromptStart');
    console.log(payload.finalPrompt);
    console.log('[PromptDebug] FinalPromptEnd');
}

