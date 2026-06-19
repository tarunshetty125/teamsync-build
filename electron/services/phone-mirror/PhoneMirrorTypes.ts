/**
 * PhoneMirrorTypes.ts
 * Shared types for the Phone Mirror feature.
 * Used by server, manager, IPC handlers, and mobile client.
 */

// ── WebSocket Message Types ────────────────────────────────────────────────

export type WsMessageType =
    | 'ai_response'       // AI response content (streaming token or final result)
    | 'status'            // Server/connection status update
    | 'heartbeat'         // Keep-alive ping
    | 'pairing_result'    // Token validation result sent after connection
    | 'error';            // Error notification

/** Envelope for every WebSocket message. */
export interface WsMessage<T = unknown> {
    type: WsMessageType;
    payload: T;
    timestamp: number;
}

// ── Payload Types ──────────────────────────────────────────────────────────

export interface AiResponsePayload {
    content: string;
    streaming: boolean;     // true = incremental token, false = final complete result
    intent?: string;        // e.g. 'what_to_answer', 'manual_chat', 'recap'
    requestId?: string;
}

export interface PairingResultPayload {
    success: boolean;
    deviceId?: string;
    error?: string;
}

export interface StatusPayload {
    serverRunning: boolean;
    connectedDevices: number;
}

export interface ErrorPayload {
    code: string;
    message: string;
}

// ── Device Info ────────────────────────────────────────────────────────────

export interface ConnectedDevice {
    id: string;
    name: string;
    connectedAt: number;
    lastHeartbeat: number;
}

// ── Server State (exposed to renderer via IPC) ─────────────────────────────

export interface PhoneMirrorState {
    enabled: boolean;
    lanAccess: boolean;
    port: number;
    pairingUrl: string | null;
    connectedDeviceCount: number;
    connectedDevices: ConnectedDevice[];
}

// ── Settings Persistence Shape ─────────────────────────────────────────────

export interface PhoneMirrorSettings {
    enabled?: boolean;
    lanAccess?: boolean;
    lastToken?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const PHONE_MIRROR_PORT = 8765;
export const PHONE_MIRROR_HEARTBEAT_INTERVAL_MS = 15_000;
export const PHONE_MIRROR_STALE_TIMEOUT_MS = 60_000;
export const PHONE_MIRROR_STALE_CHECK_INTERVAL_MS = 30_000;
