import type {
    InterviewFocusPreference,
    PreferredProvider,
    ResponseStylePreference,
} from '../personalization/preferences';
import {
    buildProviderRoutingReadModel,
    type ProviderRoutingEntry,
    type ProviderRoutingMessage,
} from './providerRoutingReadModel';
import {
    buildProviderFallbackReadModel,
    type ProviderFallbackCategory,
    type ProviderFallbackEntry,
} from './providerFallbackReadModel';

export type ProviderPersonalizationStatus =
    | 'not_captured'
    | 'auto'
    | 'applied'
    | 'fallback'
    | 'remapped'
    | 'bypassed'
    | 'satisfied_by_actual';

export type ProviderPersonalizationSource = 'ownership' | 'debug_metadata' | 'none';

export interface ProviderPersonalizationEntry {
    responseId: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    mode?: string;
    createdAt?: number;
    personalizationVersion?: number;
    resolvedCodingLanguage?: string;
    providerPreference?: PreferredProvider | string;
    responseStyle?: ResponseStylePreference | string;
    interviewFocus?: InterviewFocusPreference | string;
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
    fallbackUsed: boolean;
    fallbackCategory?: ProviderFallbackCategory;
    providerPreferenceCaptured: boolean;
    requestedMatchesPreference: boolean;
    actualMatchesPreference: boolean;
    providerPreferenceStatus: ProviderPersonalizationStatus;
    source: ProviderPersonalizationSource;
}

export interface ProviderPersonalizationSummary {
    totalResponses: number;
    capturedCount: number;
    uncapturedCount: number;
    autoCount: number;
    appliedCount: number;
    fallbackCount: number;
    remapCount: number;
    bypassedCount: number;
    satisfiedByActualCount: number;
    byProviderPreference: Record<string, number>;
    byResponseStyle: Record<string, number>;
    byInterviewFocus: Record<string, number>;
    byCodingLanguage: Record<string, number>;
    byVersion: Record<string, number>;
    byStatus: Record<string, number>;
}

export interface ProviderPersonalizationReadModel {
    entries: ProviderPersonalizationEntry[];
    byResponseId: Record<string, ProviderPersonalizationEntry>;
    activeResponseId?: string;
    activeEntry: ProviderPersonalizationEntry | null;
    summary: ProviderPersonalizationSummary;
    generatedAt: number;
}

export interface ProviderPersonalizationReadModelInput {
    responses: ProviderRoutingMessage[];
    activeResponseId?: string | null;
    now?: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(record: UnknownRecord | undefined, key: string): number | undefined {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function increment(map: Record<string, number>, key?: string | number): void {
    if (key === undefined || key === null || key === '') return;
    const normalized = String(key);
    map[normalized] = (map[normalized] ?? 0) + 1;
}

function debugMetadataFor(message: ProviderRoutingMessage): UnknownRecord | undefined {
    return asRecord(message.intelligenceMetadata ?? message.debugMetadata);
}

function readPersonalizationFromDebug(message: ProviderRoutingMessage): UnknownRecord | undefined {
    return asRecord(debugMetadataFor(message)?.personalization);
}

function hasOwnershipPersonalization(message: ProviderRoutingMessage): boolean {
    const ownership = message.ownership;
    return Boolean(
        ownership?.resolvedCodingLanguage
        || ownership?.providerPreference
        || ownership?.responseStyle
        || ownership?.interviewFocus
        || ownership?.personalizationVersion !== undefined
    );
}

function hasDebugPersonalization(message: ProviderRoutingMessage): boolean {
    const personalization = readPersonalizationFromDebug(message);
    return Boolean(
        readString(personalization, 'resolvedCodingLanguage')
        || readString(personalization, 'providerPreference')
        || readString(personalization, 'responseStyle')
        || readString(personalization, 'interviewFocus')
        || readNumber(personalization, 'personalizationVersion') !== undefined
    );
}

function deriveSource(message: ProviderRoutingMessage): ProviderPersonalizationSource {
    if (hasOwnershipPersonalization(message)) return 'ownership';
    if (hasDebugPersonalization(message)) return 'debug_metadata';
    return 'none';
}

function readPersonalizationSnapshot(message: ProviderRoutingMessage): {
    personalizationVersion?: number;
    resolvedCodingLanguage?: string;
    providerPreference?: string;
    responseStyle?: string;
    interviewFocus?: string;
} {
    const ownership = message.ownership;
    const personalization = readPersonalizationFromDebug(message);

    return {
        personalizationVersion: ownership?.personalizationVersion ?? readNumber(personalization, 'personalizationVersion'),
        resolvedCodingLanguage: ownership?.resolvedCodingLanguage ?? readString(personalization, 'resolvedCodingLanguage'),
        providerPreference: ownership?.providerPreference ?? readString(personalization, 'providerPreference'),
        responseStyle: ownership?.responseStyle ?? readString(personalization, 'responseStyle'),
        interviewFocus: ownership?.interviewFocus ?? readString(personalization, 'interviewFocus'),
    };
}

function normalizeProvider(value?: string): string | undefined {
    return value?.trim().toLowerCase();
}

function deriveProviderPreferenceStatus(args: {
    providerPreference?: string;
    route?: ProviderRoutingEntry;
    fallback?: ProviderFallbackEntry;
}): ProviderPersonalizationStatus {
    const preference = normalizeProvider(args.providerPreference);
    if (!preference) return 'not_captured';
    if (preference === 'auto') return 'auto';

    const requestedProvider = normalizeProvider(args.route?.requestedProvider);
    const actualProvider = normalizeProvider(args.route?.actualProvider);
    const requestedMatchesPreference = requestedProvider === preference;
    const actualMatchesPreference = actualProvider === preference;
    const fallbackUsed = Boolean(args.fallback || args.route?.fallbackUsed);

    if (requestedMatchesPreference && actualMatchesPreference && !fallbackUsed) {
        return 'applied';
    }

    if (requestedMatchesPreference && fallbackUsed && !actualMatchesPreference) {
        return 'fallback';
    }

    if (requestedMatchesPreference && !actualMatchesPreference) {
        return 'remapped';
    }

    if (!requestedMatchesPreference && actualMatchesPreference) {
        return 'satisfied_by_actual';
    }

    return 'bypassed';
}

function buildPersonalizationEntry(
    message: ProviderRoutingMessage,
    route?: ProviderRoutingEntry,
    fallback?: ProviderFallbackEntry,
): ProviderPersonalizationEntry {
    const snapshot = readPersonalizationSnapshot(message);
    const providerPreference = snapshot.providerPreference;
    const preference = normalizeProvider(providerPreference);
    const requestedProvider = normalizeProvider(route?.requestedProvider);
    const actualProvider = normalizeProvider(route?.actualProvider);
    const providerPreferenceCaptured = Boolean(providerPreference);
    const fallbackUsed = Boolean(fallback || route?.fallbackUsed);
    const providerPreferenceStatus = deriveProviderPreferenceStatus({
        providerPreference,
        route,
        fallback,
    });

    return {
        responseId: route?.responseId ?? message.ownership?.responseId ?? message.id,
        requestId: route?.requestId ?? message.requestId,
        questionTurnId: route?.questionTurnId ?? message.questionTurnId,
        actionId: route?.actionId ?? message.intent ?? message.source,
        mode: route?.mode ?? message.ownership?.mode,
        createdAt: route?.createdAt ?? message.timestamp,
        personalizationVersion: snapshot.personalizationVersion,
        resolvedCodingLanguage: snapshot.resolvedCodingLanguage,
        providerPreference,
        responseStyle: snapshot.responseStyle,
        interviewFocus: snapshot.interviewFocus,
        requestedProvider: route?.requestedProvider,
        requestedModel: route?.requestedModel,
        actualProvider: route?.actualProvider,
        actualModel: route?.actualModel,
        routingReason: route?.routingReason,
        fallbackUsed,
        fallbackCategory: fallback?.category,
        providerPreferenceCaptured,
        requestedMatchesPreference: Boolean(preference && requestedProvider === preference),
        actualMatchesPreference: Boolean(preference && actualProvider === preference),
        providerPreferenceStatus,
        source: deriveSource(message),
    };
}

function buildSummary(entries: ProviderPersonalizationEntry[]): ProviderPersonalizationSummary {
    const byProviderPreference: Record<string, number> = {};
    const byResponseStyle: Record<string, number> = {};
    const byInterviewFocus: Record<string, number> = {};
    const byCodingLanguage: Record<string, number> = {};
    const byVersion: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const entry of entries) {
        increment(byProviderPreference, entry.providerPreference);
        increment(byResponseStyle, entry.responseStyle);
        increment(byInterviewFocus, entry.interviewFocus);
        increment(byCodingLanguage, entry.resolvedCodingLanguage);
        increment(byVersion, entry.personalizationVersion);
        increment(byStatus, entry.providerPreferenceStatus);
    }

    return {
        totalResponses: entries.length,
        capturedCount: entries.filter((entry) => entry.source !== 'none').length,
        uncapturedCount: entries.filter((entry) => entry.source === 'none').length,
        autoCount: entries.filter((entry) => entry.providerPreferenceStatus === 'auto').length,
        appliedCount: entries.filter((entry) => entry.providerPreferenceStatus === 'applied').length,
        fallbackCount: entries.filter((entry) => entry.providerPreferenceStatus === 'fallback').length,
        remapCount: entries.filter((entry) => entry.providerPreferenceStatus === 'remapped').length,
        bypassedCount: entries.filter((entry) => entry.providerPreferenceStatus === 'bypassed').length,
        satisfiedByActualCount: entries.filter((entry) => entry.providerPreferenceStatus === 'satisfied_by_actual').length,
        byProviderPreference,
        byResponseStyle,
        byInterviewFocus,
        byCodingLanguage,
        byVersion,
        byStatus,
    };
}

export function buildProviderPersonalizationReadModel(input: ProviderPersonalizationReadModelInput): ProviderPersonalizationReadModel {
    const routing = buildProviderRoutingReadModel({
        responses: input.responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const fallback = buildProviderFallbackReadModel({
        responses: input.responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const entries = input.responses.map((message) => {
        const responseId = message.ownership?.responseId ?? message.id;
        return buildPersonalizationEntry(
            message,
            routing.byResponseId[responseId],
            fallback.byResponseId[responseId],
        );
    });
    const byResponseId = Object.fromEntries(
        entries.map((entry) => [entry.responseId, entry]),
    ) as Record<string, ProviderPersonalizationEntry>;
    const activeResponseId = input.activeResponseId ?? undefined;

    return {
        entries,
        byResponseId,
        activeResponseId,
        activeEntry: activeResponseId ? byResponseId[activeResponseId] ?? null : null,
        summary: buildSummary(entries),
        generatedAt: input.now ?? Date.now(),
    };
}
