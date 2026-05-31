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

function countOccurrences(text: string, pattern: string): number {
    return text.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length ?? 0;
}

function extractSystemPrompt(finalPrompt: string): string {
    const contextIndex = finalPrompt.indexOf('\n\n[CONTEXT]');
    const questionIndex = finalPrompt.indexOf('\n\n[USER QUESTION]');
    const endIndex = contextIndex >= 0
        ? contextIndex
        : questionIndex >= 0
            ? questionIndex
            : finalPrompt.length;
    return finalPrompt.slice(0, endIndex).replace(/^\[SYSTEM PROMPT\]\n?/, '').trim();
}

function duplicateSectionCounts(systemPrompt: string): Record<string, number> {
    const counts = new Map<string, number>();
    for (const match of systemPrompt.matchAll(/^##\s+(.+)$/gm)) {
        const title = match[1]?.trim();
        if (!title) continue;
        counts.set(title, (counts.get(title) ?? 0) + 1);
    }

    return Object.fromEntries(
        [...counts.entries()].filter(([, count]) => count > 1)
    );
}

export function logPrompt(payload: PromptDebugPayload): void {
    const systemPrompt = extractSystemPrompt(payload.finalPrompt);
    const duplicates = duplicateSectionCounts(systemPrompt);
    console.log('[PromptDebug] Metadata:', JSON.stringify({
        intent: payload.intent,
        mode: payload.mode,
        transcriptStrategy: payload.transcriptStrategy,
        transcriptLength: payload.transcriptLength,
        transcriptApproxTokens: payload.transcriptApproxTokens,
        profileUsed: payload.profileUsed,
        profilePolicy: payload.profilePolicy,
    }));
    console.log('[PromptDebug] SystemStats:', JSON.stringify({
        systemPromptLength: systemPrompt.length,
        sectionOccurrences: {
            outputContract: countOccurrences(systemPrompt, 'OUTPUT CONTRACT'),
            ocrReconstructionRules: countOccurrences(systemPrompt, 'OCR RECONSTRUCTION RULES'),
            contextPriority: countOccurrences(systemPrompt, 'CONTEXT PRIORITY'),
        },
        duplicateSectionCount: Object.keys(duplicates).length,
        duplicateSections: duplicates,
    }));
    console.log('[PromptDebug] FinalPromptStart');
    console.log(payload.finalPrompt);
    console.log('[PromptDebug] FinalPromptEnd');
}
