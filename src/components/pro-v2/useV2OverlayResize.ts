/**
 * Measures pro-v2 overlay content and pushes dimensions to the Electron window.
 * Handles the v1→v2 width mismatch on meeting start (main defaults to 600px for v1).
 */

import { useCallback, useEffect, useRef } from 'react';
import {
    V2_BAR_ONLY_WIDTH,
    V2_OVERLAY_WINDOW_DEFAULT_HEIGHT,
    V2_OVERLAY_WINDOW_MAX_HEIGHT,
    V2_OVERLAY_WINDOW_MIN_WIDTH,
    V2_PANELS_WIDTH_DEFAULT,
} from './v2Layout';

type ResizeOpts = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    panelsRowRef: React.RefObject<HTMLDivElement | null>;
    isExpanded: boolean;
    expandedPanelsWidth: number;
    showTranscriptStrip?: boolean;
};

const RESIZE_THROTTLE_MS = 300;
const V2_COLLAPSE_HOLD_MS = 380;
const V2_COLLAPSED_HEIGHT = 60;
const V2_COLLAPSED_WITH_TRANSCRIPT_HEIGHT = 152;

function computeDimensions(
    container: HTMLDivElement | null,
    panelsRow: HTMLDivElement | null,
    isExpanded: boolean,
    expandedPanelsWidth: number,
    showTranscriptStrip: boolean,
    shouldHoldExpandedShell: boolean,
): { width: number; height: number } {
    if (!isExpanded) {
        if (shouldHoldExpandedShell) {
            const height = container
                ? Math.max(Math.ceil(container.scrollHeight) + 16, V2_OVERLAY_WINDOW_DEFAULT_HEIGHT)
                : V2_OVERLAY_WINDOW_DEFAULT_HEIGHT;
            return { width: expandedPanelsWidth, height: Math.min(height, V2_OVERLAY_WINDOW_MAX_HEIGHT) };
        }
        // Keep collapsed sizing deterministic so AnimatePresence exit frames from the
        // panels cannot re-measure the old expanded stack and force a tall shell.
        const height = showTranscriptStrip
            ? V2_COLLAPSED_WITH_TRANSCRIPT_HEIGHT
            : V2_COLLAPSED_HEIGHT;
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

    return { width, height: Math.min(measuredHeight, V2_OVERLAY_WINDOW_MAX_HEIGHT) };
}

export function useV2OverlayResize({
    containerRef,
    panelsRowRef,
    isExpanded,
    expandedPanelsWidth,
    showTranscriptStrip = false,
    isMeetingActive,
    isProcessing = false,
    contentRevision = 0,
}: ResizeOpts & { isMeetingActive: boolean; isProcessing?: boolean; contentRevision?: number | string }) {
    const burstTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const lastResizeAtRef = useRef(0);
    const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const collapseReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const collapseHoldUntilRef = useRef(0);
    const wasProcessingRef = useRef(isProcessing);
    const burstGenerationRef = useRef(0);
    const lastPushedDimsRef = useRef<{ width: number; height: number } | null>(null);
    const diagramInteractingRef = useRef(false);

    const prevExpandedRef = useRef(isExpanded);
    const prevTranscriptRef = useRef(showTranscriptStrip);

    if (prevExpandedRef.current !== isExpanded || prevTranscriptRef.current !== showTranscriptStrip) {
        if (prevExpandedRef.current && !isExpanded) {
            collapseHoldUntilRef.current = Date.now() + V2_COLLAPSE_HOLD_MS;
        } else if (isExpanded) {
            collapseHoldUntilRef.current = 0;
        }
        prevExpandedRef.current = isExpanded;
        prevTranscriptRef.current = showTranscriptStrip;
    }

    const pushDimensions = useCallback((generation?: number) => {
        if (typeof generation === 'number' && generation !== burstGenerationRef.current) return;
        if (diagramInteractingRef.current) return;
        const shouldHoldExpandedShell =
            !isExpanded && Date.now() < collapseHoldUntilRef.current;
        const dims = computeDimensions(
            containerRef.current,
            panelsRowRef.current,
            isExpanded,
            expandedPanelsWidth,
            showTranscriptStrip,
            shouldHoldExpandedShell,
        );
        const previous = lastPushedDimsRef.current;
        if (previous && Math.abs(previous.width - dims.width) < 2 && Math.abs(previous.height - dims.height) < 2) {
            return;
        }
        lastPushedDimsRef.current = dims;
        window.electronAPI?.updateContentDimensions?.(dims);
    }, [containerRef, panelsRowRef, isExpanded, expandedPanelsWidth, showTranscriptStrip]);

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
        if (resizeTimerRef.current) {
            clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = null;
        }
        const generation = ++burstGenerationRef.current;
        pushDimensions(generation);
        for (const ms of [32, 120, 280, 560]) {
            burstTimersRef.current.push(setTimeout(() => pushDimensions(generation), ms));
        }
    }, [pushDimensions]);

    useEffect(
        () => () => {
            burstTimersRef.current.forEach(clearTimeout);
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
            if (collapseReleaseTimerRef.current) clearTimeout(collapseReleaseTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        if (collapseReleaseTimerRef.current) {
            clearTimeout(collapseReleaseTimerRef.current);
            collapseReleaseTimerRef.current = null;
        }

        if (!isExpanded && collapseHoldUntilRef.current > Date.now()) {
            const remaining = collapseHoldUntilRef.current - Date.now();
            collapseReleaseTimerRef.current = setTimeout(() => {
                collapseReleaseTimerRef.current = null;
                pushDimensions();
            }, remaining + 16);
        }

        return () => {
            if (collapseReleaseTimerRef.current) {
                clearTimeout(collapseReleaseTimerRef.current);
                collapseReleaseTimerRef.current = null;
            }
        };
    }, [isExpanded, pushDimensions]);

    useEffect(() => {
        scheduleResizeBurst();
    }, [scheduleResizeBurst, isExpanded, expandedPanelsWidth, isMeetingActive, contentRevision, showTranscriptStrip]);

    useEffect(() => {
        const onDiagramInteraction = (event: Event) => {
            const active = (event as CustomEvent<boolean>).detail === true;
            diagramInteractingRef.current = active;
            if (!active) {
                scheduleResizeBurst();
            }
        };
        window.addEventListener('teamsync-v2-diagram-interaction', onDiagramInteraction);
        return () => window.removeEventListener('teamsync-v2-diagram-interaction', onDiagramInteraction);
    }, [scheduleResizeBurst]);

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
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            pushDimensionsThrottled();
        });
        observer.observe(container);

        const row = panelsRowRef.current;
        if (row && isExpanded) {
            observer.observe(row);
        }

        pushDimensions();
        return () => observer.disconnect();
    }, [containerRef, panelsRowRef, isExpanded, pushDimensions, pushDimensionsThrottled]);

    return { pushDimensions, scheduleResizeBurst };
}
