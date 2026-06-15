/**
 * Measures pro-v2 overlay content and pushes dimensions to the Electron window.
 * Width comes from the shared display-aware layout contract; DOM measurement is
 * used only for height so animated panel width cannot drive BrowserWindow bounds.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
    V2_BAR_ONLY_WIDTH,
    V2_OVERLAY_WINDOW_DEFAULT_HEIGHT,
    V2_OVERLAY_WINDOW_HEIGHT_CAP,
    clampNumber,
    type OverlayLayoutConstraints,
    type V2ResponsiveLayout,
} from './v2Layout';

type ResizeOpts = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    panelsRowRef: React.RefObject<HTMLDivElement | null>;
    isExpanded: boolean;
    layout: V2ResponsiveLayout;
    constraints: OverlayLayoutConstraints | null;
    showTranscriptStrip?: boolean;
};

const RESIZE_THROTTLE_MS = 300;
const V2_COLLAPSE_HOLD_MS = 380;
const V2_MEASUREMENT_SETTLE_MS = 180;
const V2_COLLAPSED_HEIGHT = 60;
const V2_COLLAPSED_WITH_TRANSCRIPT_HEIGHT = 180;

function computeDimensions(
    container: HTMLDivElement | null,
    isExpanded: boolean,
    layout: V2ResponsiveLayout,
    constraints: OverlayLayoutConstraints,
    showTranscriptStrip: boolean,
    shouldHoldExpandedShell: boolean,
): { width: number; height: number } {
    const maxWidth = constraints.maxWidth;
    const maxHeight = Math.min(constraints.maxHeight, V2_OVERLAY_WINDOW_HEIGHT_CAP);
    const minWidth = Math.min(constraints.minWidth, maxWidth);

    if (!isExpanded) {
        if (shouldHoldExpandedShell) {
            const height = container
                ? Math.max(Math.ceil(container.scrollHeight) + 16, V2_OVERLAY_WINDOW_DEFAULT_HEIGHT)
                : V2_OVERLAY_WINDOW_DEFAULT_HEIGHT;
            return {
                width: clampNumber(layout.windowWidth, minWidth, maxWidth),
                height: clampNumber(height, constraints.minHeight, maxHeight),
            };
        }
        // Keep collapsed sizing deterministic so AnimatePresence exit frames from the
        // panels cannot re-measure the old expanded stack and force a tall shell.
        const height = showTranscriptStrip
            ? V2_COLLAPSED_WITH_TRANSCRIPT_HEIGHT
            : V2_COLLAPSED_HEIGHT;
        return {
            width: clampNumber(Math.min(V2_BAR_ONLY_WIDTH, maxWidth), minWidth, maxWidth),
            height: clampNumber(height, constraints.minHeight, maxHeight),
        };
    }

    const measuredHeight = container
        ? Math.max(Math.ceil(container.scrollHeight) + 16, V2_OVERLAY_WINDOW_DEFAULT_HEIGHT)
        : V2_OVERLAY_WINDOW_DEFAULT_HEIGHT;

    return {
        width: clampNumber(layout.windowWidth, minWidth, maxWidth),
        height: clampNumber(measuredHeight, constraints.minHeight, maxHeight),
    };
}

export function useV2OverlayResize({
    containerRef,
    panelsRowRef,
    isExpanded,
    layout,
    constraints,
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
    const overlayDraggingRef = useRef(false);
    const measurementSettlesAtRef = useRef(0);

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

    const clearPendingResizeWork = useCallback(() => {
        burstTimersRef.current.forEach(clearTimeout);
        burstTimersRef.current = [];
        if (resizeTimerRef.current) {
            clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = null;
        }
    }, []);

    const pushDimensions = useCallback((generation?: number) => {
        if (typeof generation === 'number' && generation !== burstGenerationRef.current) return;
        if (!constraints) return;
        if (overlayDraggingRef.current) return;
        if (diagramInteractingRef.current) return;
        const shouldHoldExpandedShell =
            !isExpanded && Date.now() < collapseHoldUntilRef.current;
        let dims = computeDimensions(
            containerRef.current,
            isExpanded,
            layout,
            constraints,
            showTranscriptStrip,
            shouldHoldExpandedShell,
        );
        const previous = lastPushedDimsRef.current;
        if (
            previous &&
            isExpanded &&
            Date.now() < measurementSettlesAtRef.current &&
            dims.width === previous.width &&
            dims.height < previous.height
        ) {
            dims = { ...dims, height: previous.height };
        }
        if (previous && Math.abs(previous.width - dims.width) < 2 && Math.abs(previous.height - dims.height) < 2) {
            return;
        }
        lastPushedDimsRef.current = dims;
        window.electronAPI?.updateContentDimensions?.(dims);
    }, [constraints, containerRef, isExpanded, layout, showTranscriptStrip]);

    const pushDimensionsThrottled = useCallback(() => {
        if (overlayDraggingRef.current) return;
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
        if (overlayDraggingRef.current) return;
        clearPendingResizeWork();
        measurementSettlesAtRef.current = Date.now() + V2_MEASUREMENT_SETTLE_MS;
        const generation = ++burstGenerationRef.current;
        pushDimensions(generation);
        for (const ms of [V2_MEASUREMENT_SETTLE_MS, 360, 620]) {
            burstTimersRef.current.push(setTimeout(() => pushDimensions(generation), ms));
        }
    }, [clearPendingResizeWork, pushDimensions]);

    useEffect(
        () => () => {
            clearPendingResizeWork();
            if (collapseReleaseTimerRef.current) clearTimeout(collapseReleaseTimerRef.current);
        },
        [clearPendingResizeWork],
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
    }, [
        scheduleResizeBurst,
        isExpanded,
        layout.mode,
        layout.windowWidth,
        layout.contentWidth,
        constraints?.displayId,
        constraints?.maxWidth,
        constraints?.maxHeight,
        isMeetingActive,
        contentRevision,
        showTranscriptStrip,
    ]);

    useEffect(() => {
        if (!window.electronAPI?.onOverlayDragStateChanged) return;
        const unsubscribe = window.electronAPI.onOverlayDragStateChanged((dragging) => {
            overlayDraggingRef.current = dragging;
            if (dragging) {
                clearPendingResizeWork();
            } else {
                scheduleResizeBurst();
            }
        });
        return () => unsubscribe();
    }, [clearPendingResizeWork, scheduleResizeBurst]);

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
            measurementSettlesAtRef.current = Date.now() + V2_MEASUREMENT_SETTLE_MS;
            pushDimensionsThrottled();
        });
        observer.observe(container);

        pushDimensions();
        return () => observer.disconnect();
    }, [containerRef, panelsRowRef, isExpanded, pushDimensions, pushDimensionsThrottled]);

    return { pushDimensions, scheduleResizeBurst };
}
