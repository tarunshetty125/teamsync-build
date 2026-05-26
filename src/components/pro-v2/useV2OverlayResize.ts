/**
 * Measures pro-v2 overlay content and pushes dimensions to the Electron window.
 * Handles the v1→v2 width mismatch on meeting start (main defaults to 600px for v1).
 */

import { useCallback, useEffect, useRef } from 'react';
import {
    V2_BAR_ONLY_WIDTH,
    V2_OVERLAY_WINDOW_DEFAULT_HEIGHT,
    V2_OVERLAY_WINDOW_MIN_WIDTH,
    V2_PANELS_WIDTH_DEFAULT,
} from './v2Layout';

type ResizeOpts = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    panelsRowRef: React.RefObject<HTMLDivElement | null>;
    isExpanded: boolean;
    expandedPanelsWidth: number;
    showTranscript?: boolean;
};

const RESIZE_THROTTLE_MS = 250;

function computeDimensions(
    container: HTMLDivElement | null,
    panelsRow: HTMLDivElement | null,
    isExpanded: boolean,
    expandedPanelsWidth: number,
): { width: number; height: number } {
    if (!isExpanded) {
        const height = container
            ? Math.max(Math.ceil(container.scrollHeight) + 16, 60)
            : 60;
        return { width: V2_BAR_ONLY_WIDTH, height };
    }

    const measuredWidth = Math.ceil((panelsRow?.scrollWidth ?? container?.scrollWidth ?? 0) + 16);
    const width = Math.max(
        measuredWidth,
        expandedPanelsWidth,
        V2_PANELS_WIDTH_DEFAULT,
        V2_OVERLAY_WINDOW_MIN_WIDTH,
    );

    const measuredHeight = container
        ? Math.max(Math.ceil(container.scrollHeight) + 16, V2_OVERLAY_WINDOW_DEFAULT_HEIGHT)
        : V2_OVERLAY_WINDOW_DEFAULT_HEIGHT;

    return { width, height: measuredHeight };
}

export function useV2OverlayResize({
    containerRef,
    panelsRowRef,
    isExpanded,
    expandedPanelsWidth,
    showTranscript,
    isMeetingActive,
    isProcessing = false,
    contentRevision = 0,
}: ResizeOpts & { isMeetingActive: boolean; isProcessing?: boolean; contentRevision?: number | string }) {
    const burstTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const isTransitioningRef = useRef(false);
    const lastResizeAtRef = useRef(0);
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wasProcessingRef = useRef(isProcessing);

    useEffect(() => {
        isTransitioningRef.current = true;
        const t = setTimeout(() => {
            isTransitioningRef.current = false;
        }, 400);
        return () => clearTimeout(t);
    }, [isExpanded, showTranscript]);

    const pushDimensions = useCallback(() => {
        const dims = computeDimensions(
            containerRef.current,
            panelsRowRef.current,
            isExpanded,
            expandedPanelsWidth,
        );
        window.electronAPI?.updateContentDimensions?.(dims);
    }, [containerRef, panelsRowRef, isExpanded, expandedPanelsWidth]);

    const pushDimensionsThrottled = useCallback(() => {
        const now = Date.now();
        const elapsed = now - lastResizeAtRef.current;
        if (elapsed >= RESIZE_THROTTLE_MS) {
            lastResizeAtRef.current = now;
            pushDimensions();
            return;
        }
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => {
            lastResizeAtRef.current = Date.now();
            resizeTimerRef.current = null;
            pushDimensions();
        }, RESIZE_THROTTLE_MS - elapsed);
    }, [pushDimensions]);

    const scheduleResizeBurst = useCallback(() => {
        burstTimersRef.current.forEach(clearTimeout);
        burstTimersRef.current = [];
        pushDimensions();
        for (const ms of [0, 16, 50, 100, 200, 400, 800, 1200]) {
            burstTimersRef.current.push(setTimeout(pushDimensions, ms));
        }
    }, [pushDimensions]);

    useEffect(
        () => () => {
            burstTimersRef.current.forEach(clearTimeout);
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        pushDimensions();
        const t = setTimeout(pushDimensions, 16);
        return () => clearTimeout(t);
    }, [pushDimensions, isExpanded, expandedPanelsWidth, isMeetingActive, contentRevision]);

    useEffect(() => {
        if (!window.electronAPI?.onSessionReset) return;
        const unsubSession = window.electronAPI.onSessionReset(() => {
            scheduleResizeBurst();
        });
        return () => unsubSession();
    }, [scheduleResizeBurst]);

    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        const unsubEnsure = window.electronAPI.onEnsureExpanded(() => {
            scheduleResizeBurst();
        });
        return () => unsubEnsure();
    }, [scheduleResizeBurst]);

    useEffect(() => {
        if (wasProcessingRef.current && !isProcessing) {
            scheduleResizeBurst();
        }
        wasProcessingRef.current = isProcessing;
    }, [isProcessing, scheduleResizeBurst]);

    useEffect(() => {
        const row = panelsRowRef.current;
        if (!row || !isExpanded) return;
        const observer = new ResizeObserver(() => {
            if (isTransitioningRef.current) return;
            pushDimensionsThrottled();
        });
        observer.observe(row);
        if (containerRef.current) observer.observe(containerRef.current);
        pushDimensions();
        return () => observer.disconnect();
    }, [containerRef, panelsRowRef, isExpanded, pushDimensions, pushDimensionsThrottled]);

    return { pushDimensions, scheduleResizeBurst };
}
