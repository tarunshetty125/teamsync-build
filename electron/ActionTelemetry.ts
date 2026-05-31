export interface RoutingDecision {
    requestedModel: string;
    requestedProvider: string;
    actualModel: string;
    actualProvider: string;
    reason: string;
}

export interface FallbackChainEntry {
    model: string;
    provider: string;
    result: 'success' | 'failure' | 'skipped';
    reason?: string;
    startedAt?: number;
    completedAt?: number;
}

export interface ValidationOutcome {
    valid: boolean;
    warnings: string[];
    issues: string[];
    repairApplied: boolean;
}

export interface ActionTelemetry {
    requestId: string;
    actionType: string;
    selectedModel: string;
    selectedProvider: string;
    actualInvokedModel: string;
    actualInvokedProvider: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
    validationResult: string;
    rawLength: number;
    parsedLength: number;
    promptTokens?: number;
    completionTokens?: number;
    startedAt: number;
    completedAt: number;
}

export interface PromptAuditResult {
    outputContractCount: number;
    codingContractCount: number;
    contextPriorityCount: number;
    duplicateSectionCount: number;
    sectionTitles: string[];
}

function stableStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({ serializationError: true });
    }
}

function countPattern(text: string, pattern: RegExp): number {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}

export function auditPromptText(finalPrompt: string): PromptAuditResult {
    const sectionTitles = Array.from(finalPrompt.matchAll(/^##\s+(.+)$/gm))
        .map((match) => match[1].trim().toUpperCase());
    const counts = new Map<string, number>();
    for (const title of sectionTitles) {
        counts.set(title, (counts.get(title) ?? 0) + 1);
    }

    const duplicateSectionCount = Array.from(counts.values())
        .filter((count) => count > 1)
        .reduce((sum, count) => sum + count - 1, 0);
    const explicitCodingContracts = countPattern(finalPrompt, /^##\s+CODING CONTRACT\b/gim);
    const embeddedCodingContracts = countPattern(finalPrompt, /Return a complete coding interview answer with these sections in order:/g);

    return {
        outputContractCount: countPattern(finalPrompt, /^##\s+OUTPUT CONTRACT\b/gim),
        codingContractCount: explicitCodingContracts + embeddedCodingContracts,
        contextPriorityCount: countPattern(finalPrompt, /^##\s+CONTEXT PRIORITY\b/gim),
        duplicateSectionCount,
        sectionTitles,
    };
}

export function emitPromptAudit(payload: {
    requestId: string;
    actionType: string;
    promptTokens?: number;
    finalPrompt: string;
}): PromptAuditResult {
    const audit = auditPromptText(payload.finalPrompt);
    console.log('[PROMPT_AUDIT]', stableStringify({
        requestId: payload.requestId,
        actionType: payload.actionType,
        promptTokens: payload.promptTokens,
        outputContractCount: audit.outputContractCount,
        codingContractCount: audit.codingContractCount,
        contextPriorityCount: audit.contextPriorityCount,
        duplicateSectionCount: audit.duplicateSectionCount,
    }));
    return audit;
}

export function emitModelSelection(payload: {
    requestId: string;
    actionType: string;
    routing: RoutingDecision;
}): void {
    console.log(
        `[MODEL_SELECTION] requestId=${payload.requestId} actionType=${payload.actionType} ` +
        `requested=${payload.routing.requestedModel} actual=${payload.routing.actualModel} ` +
        `requestedProvider=${payload.routing.requestedProvider} actualProvider=${payload.routing.actualProvider} ` +
        `reason=${payload.routing.reason}`
    );
}

export function emitValidationResult(payload: {
    requestId: string;
    actionType: string;
    outcome: ValidationOutcome;
    rawLength: number;
    parsedLength: number;
}): void {
    console.log('[VALIDATION_RESULT]', stableStringify({
        requestId: payload.requestId,
        actionType: payload.actionType,
        valid: payload.outcome.valid,
        warnings: payload.outcome.warnings,
        issues: payload.outcome.issues,
        repairApplied: payload.outcome.repairApplied,
        rawLength: payload.rawLength,
        parsedLength: payload.parsedLength,
    }));
}

export function emitFallback(payload: {
    requestId: string;
    actionType: string;
    primaryModel: string;
    failureReason: string;
    fallbackModel?: string;
    fallbackProvider?: string;
}): void {
    console.log(
        `[FALLBACK] requestId=${payload.requestId} actionType=${payload.actionType} ` +
        `primaryModel=${payload.primaryModel} failureReason=${payload.failureReason} ` +
        `fallbackModel=${payload.fallbackModel ?? 'none'} fallbackProvider=${payload.fallbackProvider ?? 'none'}`
    );
}

export function emitActionComplete(telemetry: ActionTelemetry): void {
    console.log('[ACTION_COMPLETE]', stableStringify(telemetry));
}
