import { useCallback, useEffect, useRef } from 'react';
import { isStaleSessionPayload } from './sessionPayload';

type UseOverlayActiveSessionOptions = {
    onSessionReset: (payload?: { sessionId?: string }) => void;
};

/**
 * Tracks the active intelligence session id for dropping stale IPC payloads.
 * Initializes from main on mount; updates on session-reset.
 */
export function useOverlayActiveSession({ onSessionReset }: UseOverlayActiveSessionOptions) {
    const activeSessionIdRef = useRef<string | null>(null);

    const applySessionId = useCallback((sessionId: string | undefined) => {
        if (sessionId) {
            activeSessionIdRef.current = sessionId;
        }
    }, []);

    const syncSessionIdFromMain = useCallback(async () => {
        try {
            const result = await window.electronAPI?.getSessionId?.();
            applySessionId(result?.sessionId);
        } catch {
            /* overlay may mount before IPC is ready */
        }
    }, [applySessionId]);

    const isStalePayload = useCallback(
        (payloadSessionId: string | undefined) =>
            isStaleSessionPayload(payloadSessionId, activeSessionIdRef.current),
        [],
    );

    /** Adopt _sessionId from first IPC payload if mount IPC raced. */
    const adoptSessionIdFromPayload = useCallback(
        (payloadSessionId: string | undefined) => {
            if (payloadSessionId && !activeSessionIdRef.current) {
                activeSessionIdRef.current = payloadSessionId;
            }
        },
        [],
    );

    useEffect(() => {
        void syncSessionIdFromMain();
    }, [syncSessionIdFromMain]);

    useEffect(() => {
        if (!window.electronAPI?.onSessionReset) return;
        return window.electronAPI.onSessionReset((payload) => {
            applySessionId(payload?.sessionId);
            onSessionReset(payload);
        });
    }, [applySessionId, onSessionReset]);

    return {
        activeSessionIdRef,
        syncSessionIdFromMain,
        isStalePayload,
        adoptSessionIdFromPayload,
    };
}
