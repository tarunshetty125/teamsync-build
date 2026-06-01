import type { ResponseOwnership } from './actionContextTypes';

export interface ResponseRoutingOwnershipMetadata {
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
}

export interface ResponsePersonalizationOwnershipMetadata {
    resolvedCodingLanguage?: string;
    providerPreference?: string;
    responseStyle?: string;
    interviewFocus?: string;
    personalizationVersion?: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' ? value as UnknownRecord : undefined;
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(record: UnknownRecord | undefined, key: string): number | undefined {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function valuesDiffer(a?: string, b?: string): boolean {
    return Boolean(a && b && a !== b);
}

export function extractRoutingOwnershipMetadata(debugMetadata?: unknown): ResponseRoutingOwnershipMetadata {
    const debug = asRecord(debugMetadata);
    const routing = asRecord(debug?.routing);
    const telemetry = asRecord(debug?.telemetry);

    const requestedProvider =
        readString(routing, 'requestedProvider')
        ?? readString(telemetry, 'selectedProvider');
    const requestedModel =
        readString(routing, 'requestedModel')
        ?? readString(telemetry, 'selectedModel');
    const actualProvider =
        readString(routing, 'actualProvider')
        ?? readString(telemetry, 'actualInvokedProvider');
    const actualModel =
        readString(routing, 'actualModel')
        ?? readString(telemetry, 'actualInvokedModel');
    const reason =
        readString(routing, 'reason')
        ?? readString(telemetry, 'fallbackReason');
    const fallbackUsed = telemetry?.fallbackUsed === true;
    const routeChanged =
        fallbackUsed
        || valuesDiffer(requestedProvider, actualProvider)
        || valuesDiffer(requestedModel, actualModel);

    return {
        requestedProvider,
        requestedModel,
        actualProvider,
        actualModel,
        routingReason: reason && (routeChanged || reason !== 'requested_model') ? reason : undefined,
    };
}

export function hasRoutingOwnershipMetadata(metadata: ResponseRoutingOwnershipMetadata): boolean {
    return Boolean(
        metadata.requestedProvider
        || metadata.requestedModel
        || metadata.actualProvider
        || metadata.actualModel
        || metadata.routingReason
    );
}

export function extractPersonalizationOwnershipMetadata(debugMetadata?: unknown): ResponsePersonalizationOwnershipMetadata {
    const debug = asRecord(debugMetadata);
    const personalization = asRecord(debug?.personalization);

    return {
        resolvedCodingLanguage: readString(personalization, 'resolvedCodingLanguage'),
        providerPreference: readString(personalization, 'providerPreference'),
        responseStyle: readString(personalization, 'responseStyle'),
        interviewFocus: readString(personalization, 'interviewFocus'),
        personalizationVersion: readNumber(personalization, 'personalizationVersion'),
    };
}

export function hasPersonalizationOwnershipMetadata(metadata: ResponsePersonalizationOwnershipMetadata): boolean {
    return Boolean(
        metadata.resolvedCodingLanguage
        || metadata.providerPreference
        || metadata.responseStyle
        || metadata.interviewFocus
        || metadata.personalizationVersion
    );
}

export function applyPersonalizationMetadataToOwnership(
    ownership: ResponseOwnership | undefined,
    debugMetadata?: unknown,
): ResponseOwnership | undefined {
    const personalization = extractPersonalizationOwnershipMetadata(debugMetadata);
    if (!ownership || !hasPersonalizationOwnershipMetadata(personalization)) return ownership;

    return {
        ...ownership,
        resolvedCodingLanguage: personalization.resolvedCodingLanguage ?? ownership.resolvedCodingLanguage,
        providerPreference: personalization.providerPreference ?? ownership.providerPreference,
        responseStyle: personalization.responseStyle ?? ownership.responseStyle,
        interviewFocus: personalization.interviewFocus ?? ownership.interviewFocus,
        personalizationVersion: personalization.personalizationVersion ?? ownership.personalizationVersion,
    };
}

export function applyRoutingMetadataToOwnership(
    ownership: ResponseOwnership | undefined,
    debugMetadata?: unknown,
): ResponseOwnership | undefined {
    const routing = extractRoutingOwnershipMetadata(debugMetadata);
    if (!ownership || !hasRoutingOwnershipMetadata(routing)) return ownership;

    const nextOwnership: ResponseOwnership = {
        ...ownership,
        requestedProvider: routing.requestedProvider ?? ownership.requestedProvider,
        requestedModel: routing.requestedModel ?? ownership.requestedModel,
        actualProvider: routing.actualProvider ?? ownership.actualProvider,
        actualModel: routing.actualModel ?? ownership.actualModel,
        routingReason: routing.routingReason ?? ownership.routingReason,
    };

    if (!nextOwnership.sourceProvider && nextOwnership.requestedProvider) {
        nextOwnership.sourceProvider = nextOwnership.requestedProvider;
    }
    if (!nextOwnership.sourceModel && nextOwnership.requestedModel) {
        nextOwnership.sourceModel = nextOwnership.requestedModel;
    }

    return nextOwnership;
}
