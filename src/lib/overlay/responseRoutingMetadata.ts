import type { ResponseOwnership } from './actionContextTypes';

export interface ResponseRoutingOwnershipMetadata {
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' ? value as UnknownRecord : undefined;
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
