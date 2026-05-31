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
    void payload;
}
