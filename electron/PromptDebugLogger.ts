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

function sectionTitleCounts(systemPrompt: string): Record<string, number> {
    const counts: Record<string, number> = {
        outputContract: 0,
        contextPriority: 0,
        format: 0,
        codingContract: 0,
    };

    for (const match of systemPrompt.matchAll(/^##\s+(.+)$/gm)) {
        const title = match[1]?.trim().toUpperCase();
        if (!title) continue;
        if (title === 'OUTPUT CONTRACT') counts.outputContract += 1;
        if (title === 'CONTEXT PRIORITY') counts.contextPriority += 1;
        if (title === 'FORMAT' || title === 'FORMAT CONTRACT') counts.format += 1;
        if (title === 'CODING CONTRACT') counts.codingContract += 1;
    }

    return counts;
}

export function logPrompt(payload: PromptDebugPayload): void {
    const systemPrompt = extractSystemPrompt(payload.finalPrompt);
    const duplicates = duplicateSectionCounts(systemPrompt);
    const sectionCounts = sectionTitleCounts(systemPrompt);
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
            outputContract: sectionCounts.outputContract,
            ocrReconstructionRules: countOccurrences(systemPrompt, 'OCR RECONSTRUCTION RULES'),
            contextPriority: sectionCounts.contextPriority,
            format: sectionCounts.format,
            codingContract: sectionCounts.codingContract,
        },
        duplicateSectionCount: Object.keys(duplicates).length,
        duplicateSections: duplicates,
    }));
    console.log(
        `[PROMPT_AUDIT] OUTPUT_CONTRACT_COUNT=${sectionCounts.outputContract} ` +
        `CONTEXT_PRIORITY_COUNT=${sectionCounts.contextPriority} ` +
        `FORMAT_COUNT=${sectionCounts.format} ` +
        `CODING_CONTRACT_COUNT=${sectionCounts.codingContract} ` +
        `DUPLICATE_SECTION_COUNT=${Object.keys(duplicates).length}`
    );
    console.log('[PromptDebug] FinalPromptStart');
    console.log(payload.finalPrompt);
    console.log('[PromptDebug] FinalPromptEnd');
}
