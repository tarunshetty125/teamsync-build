/**
 * IPC stream listeners shared by V1/V2 overlay renderers.
 * Presentation-only: routes tokens to the correct request channel.
 */

import { useEffect } from 'react';
import { mergeStreamChunk } from '../../lib/overlay/mergeStreamChunk';
import type { V2Message } from './useCluelyOverlayBridge';

export type OverlayRequestChannel = 'chat' | 'intelligence' | 'rag' | 'screen_scan';

export interface OverlayIpcStreamsContext {
    isStalePayload: (payloadSessionId?: string) => boolean;
    activeChatRequestIdRef: React.MutableRefObject<string | null>;
    activeIntelligenceRequestIdRef: React.MutableRefObject<string | null>;
    activeRagRequestIdRef: React.MutableRefObject<string | null>;
    activeScreenScanRequestIdRef: React.MutableRefObject<string | null>;
    activeIntentRequestIdsRef: React.MutableRefObject<Record<string, string>>;
    requestStartTimeRef: React.MutableRefObject<number | null>;
    setMessages: React.Dispatch<React.SetStateAction<V2Message[]>>;
    setIsProcessing: (value: boolean) => void;
    setIsExpanded: (value: boolean) => void;
    nextMsgId: () => string;
    finishStreamingMessage: (requestId: string, intent?: string) => void;
    rememberIntentRequest: (intent: string, requestId: string | null) => void;
    resolveIntentRequestId: (intent: string, requestId?: string | null) => string | null;
}

function matchesRequestChannel(
    ctx: OverlayIpcStreamsContext,
    requestId: string | null | undefined,
    channel: OverlayRequestChannel,
): boolean {
    if (!requestId) return false;
    switch (channel) {
        case 'chat':
            return ctx.activeChatRequestIdRef.current === requestId;
        case 'intelligence':
            return ctx.activeIntelligenceRequestIdRef.current === requestId;
        case 'rag':
            return ctx.activeRagRequestIdRef.current === requestId;
        case 'screen_scan':
            return ctx.activeScreenScanRequestIdRef.current === requestId;
        default:
            return false;
    }
}

function appendToken(
    ctx: OverlayIpcStreamsContext,
    requestId: string,
    token: string,
    options?: { storeNegotiationJson?: boolean },
) {
    if (options?.storeNegotiationJson !== false) {
        try {
            const parsed = JSON.parse(token);
            if (parsed?.__negotiationCoaching) {
                ctx.setMessages((prev) => {
                    const idx = prev.findIndex((msg) => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    u[idx] = { ...u[idx], text: token };
                    return u;
                });
                return;
            }
        } catch {
            /* plain text */
        }
    }

    ctx.setMessages((prev) => {
        const idx = prev.findIndex((msg) => msg.requestId === requestId);
        if (idx < 0) return prev;
        const u = [...prev];
        const nextText = mergeStreamChunk(u[idx].text, token);
        u[idx] = { ...u[idx], text: nextText, isCode: nextText.includes('```') };
        return u;
    });
}

function hydrateFinalMessage(
    ctx: OverlayIpcStreamsContext,
    requestId: string,
    text: string,
) {
    ctx.setMessages((prev) => {
        const idx = prev.findIndex((msg) => msg.requestId === requestId);
        if (idx < 0) return prev;
        const u = [...prev];
        u[idx] = {
            ...u[idx],
            text,
            isCode: text.includes('```'),
        };
        return u;
    });
}

export function useOverlayIpcStreams(ctx: OverlayIpcStreamsContext) {
    useEffect(() => {
        const cleanups: Array<() => void> = [];

        cleanups.push(
            window.electronAPI.onGeminiStreamToken((payload: any) => {
                if (ctx.isStalePayload(payload?._sessionId)) return;
                const token = typeof payload === 'string' ? payload : payload.token;
                const requestId =
                    typeof payload === 'string'
                        ? ctx.activeChatRequestIdRef.current
                        : payload.requestId || ctx.activeChatRequestIdRef.current;
                if (!requestId || !matchesRequestChannel(ctx, requestId, 'chat')) return;
                appendToken(ctx, requestId, token);
            }),
        );

        cleanups.push(
            window.electronAPI.onGeminiStreamDone((payload: any) => {
                if (ctx.isStalePayload(payload?._sessionId)) return;
                const requestId = payload?.requestId || ctx.activeChatRequestIdRef.current;
                if (!requestId || !matchesRequestChannel(ctx, requestId, 'chat')) return;
                if (typeof payload?.content === 'string' && payload.content.trim()) {
                    hydrateFinalMessage(ctx, requestId, payload.content);
                }
                ctx.finishStreamingMessage(requestId);
            }),
        );

        cleanups.push(
            window.electronAPI.onGeminiStreamError((payload: any) => {
                if (ctx.isStalePayload(payload?._sessionId)) return;
                const error = typeof payload === 'string' ? payload : payload.error;
                const requestId =
                    typeof payload === 'string'
                        ? ctx.activeChatRequestIdRef.current
                        : payload.requestId || ctx.activeChatRequestIdRef.current;
                if (!requestId || !matchesRequestChannel(ctx, requestId, 'chat')) return;
                ctx.setIsProcessing(false);
                ctx.requestStartTimeRef.current = null;
                ctx.activeChatRequestIdRef.current = null;
                ctx.setMessages((prev) => {
                    const idx = prev.findIndex((msg) => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    u[idx] = { ...u[idx], text: `❌ Error: ${error}`, isStreaming: false };
                    return u;
                });
            }),
        );

        if (window.electronAPI.onScreenshotCaptureBlocked) {
            cleanups.push(
                window.electronAPI.onScreenshotCaptureBlocked((payload: { error: string }) => {
                    ctx.setIsProcessing(false);
                    ctx.setIsExpanded(true);
                    ctx.setMessages((prev) => [
                        ...prev,
                        {
                            id: ctx.nextMsgId(),
                            timestamp: Date.now(),
                            role: 'system',
                            text: payload.error,
                            source: 'Screen Capture',
                            isStreaming: false,
                        },
                    ]);
                }),
            );
        }

        if (window.electronAPI.onRAGStreamChunk) {
            cleanups.push(
                window.electronAPI.onRAGStreamChunk((data: any) => {
                    if (ctx.isStalePayload(data?._sessionId)) return;
                    const requestId = data.requestId || ctx.activeRagRequestIdRef.current;
                    if (!requestId || !matchesRequestChannel(ctx, requestId, 'rag')) return;
                    appendToken(ctx, requestId, data.chunk);
                }),
            );
        }

        if (window.electronAPI.onRAGStreamComplete) {
            cleanups.push(
                window.electronAPI.onRAGStreamComplete((data: any) => {
                    if (ctx.isStalePayload(data?._sessionId)) return;
                    const requestId = data.requestId || ctx.activeRagRequestIdRef.current;
                    if (!requestId || !matchesRequestChannel(ctx, requestId, 'rag')) return;
                    ctx.finishStreamingMessage(requestId);
                }),
            );
        }

        if (window.electronAPI.onRAGStreamError) {
            cleanups.push(
                window.electronAPI.onRAGStreamError((data: any) => {
                    if (ctx.isStalePayload(data?._sessionId)) return;
                    const requestId = data.requestId || ctx.activeRagRequestIdRef.current;
                    if (!requestId || !matchesRequestChannel(ctx, requestId, 'rag')) return;
                    ctx.setIsProcessing(false);
                    ctx.activeRagRequestIdRef.current = null;
                    ctx.setMessages((prev) => {
                        const idx = prev.findIndex((msg) => msg.requestId === requestId);
                        if (idx < 0) return prev;
                        const u = [...prev];
                        u[idx] = { ...u[idx], text: `❌ RAG Error: ${data.error}`, isStreaming: false };
                        return u;
                    });
                }),
            );
        }

        if (window.electronAPI.onIntelligenceActionToken) {
            cleanups.push(
                window.electronAPI.onIntelligenceActionToken((data: any) => {
                    if (data.intent === 'manual_chat') return;
                    if (ctx.isStalePayload(data._sessionId)) return;
                    const isScreenScan = data.intent === 'screen_scan';
                    const requestId = isScreenScan
                        ? data.requestId || ctx.activeScreenScanRequestIdRef.current
                        : data.requestId || ctx.activeIntelligenceRequestIdRef.current;
                    if (!requestId) return;
                    const channel: OverlayRequestChannel = isScreenScan ? 'screen_scan' : 'intelligence';
                    if (!matchesRequestChannel(ctx, requestId, channel)) {
                        return;
                    }
                    if (!data.token) return;
                    appendToken(ctx, requestId, data.token);
                }),
            );
        }

        if (window.electronAPI.onIntelligenceActionResult) {
            cleanups.push(
                window.electronAPI.onIntelligenceActionResult((data: any) => {
                    if (data.intent === 'manual_chat') return;
                    if (ctx.isStalePayload(data._sessionId)) return;
                    const isScreenScan = data.intent === 'screen_scan';
                    const requestId = isScreenScan
                        ? data.requestId || ctx.activeScreenScanRequestIdRef.current
                        : data.requestId || ctx.activeIntelligenceRequestIdRef.current;
                    if (!requestId) return;
                    const channel: OverlayRequestChannel = isScreenScan ? 'screen_scan' : 'intelligence';
                    if (!matchesRequestChannel(ctx, requestId, channel)) return;
                    if (isScreenScan && typeof data.content === 'string') {
                        hydrateFinalMessage(ctx, requestId, data.content);
                    }
                    ctx.finishStreamingMessage(requestId, data.intent);
                    if (isScreenScan) {
                        ctx.activeScreenScanRequestIdRef.current = null;
                        ctx.rememberIntentRequest('screen_scan', null);
                    } else {
                        ctx.rememberIntentRequest(data.intent, null);
                    }
                }),
            );
        }

        if (window.electronAPI.onIntelligenceScreenScanToken) {
            cleanups.push(
                window.electronAPI.onIntelligenceScreenScanToken(() => {
                    // Screen scan tokens normally arrive through the generic
                    // intelligence-action-token channel. Keeping this listener
                    // mounted avoids contract drift, but we intentionally no-op
                    // here to prevent double-appending the same chunks.
                }),
            );
        }

        if (window.electronAPI.onIntelligenceScreenScanResult) {
            cleanups.push(
                window.electronAPI.onIntelligenceScreenScanResult((data: any) => {
                    if (ctx.isStalePayload(data._sessionId)) return;
                    const requestId = ctx.resolveIntentRequestId('screen_scan', data.requestId);
                    if (!requestId) return;
                    if (
                        ctx.activeScreenScanRequestIdRef.current &&
                        requestId !== ctx.activeScreenScanRequestIdRef.current
                    ) {
                        return;
                    }
                    if (typeof data.answer === 'string') {
                        hydrateFinalMessage(ctx, requestId, data.answer);
                    }
                    ctx.finishStreamingMessage(requestId, 'screen_scan');
                    ctx.activeScreenScanRequestIdRef.current = null;
                    ctx.rememberIntentRequest('screen_scan', null);
                }),
            );
        }

        if (window.electronAPI.onIntelligenceError) {
            cleanups.push(
                window.electronAPI.onIntelligenceError((data: any) => {
                    if (data.mode === 'manual') return;
                    if (ctx.isStalePayload(data._sessionId)) return;
                    if (!data.requestId) return;
                    ctx.setIsProcessing(false);
                    if (data.mode === 'screen_scan') {
                        if (
                            !ctx.activeScreenScanRequestIdRef.current ||
                            data.requestId === ctx.activeScreenScanRequestIdRef.current
                        ) {
                            ctx.activeScreenScanRequestIdRef.current = null;
                        }
                        ctx.rememberIntentRequest('screen_scan', null);
                    }
                    if (ctx.activeIntelligenceRequestIdRef.current === data.requestId) {
                        ctx.activeIntelligenceRequestIdRef.current = null;
                    }
                    ctx.setMessages((prev) => {
                        const idx = prev.findIndex((msg) => msg.requestId === data.requestId);
                        if (idx < 0) return prev;
                        const u = [...prev];
                        u[idx] = {
                            ...u[idx],
                            text: `❌ Error (${data.mode}): ${data.error}`,
                            isStreaming: false,
                        };
                        return u;
                    });
                }),
            );
        }

        return () => cleanups.forEach((fn) => fn());
    }, [
        ctx.isStalePayload,
        ctx.finishStreamingMessage,
        ctx.rememberIntentRequest,
        ctx.resolveIntentRequestId,
        ctx.setIsProcessing,
        ctx.setMessages,
    ]);
}
