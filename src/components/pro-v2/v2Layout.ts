/** Compatibility exports for pro-v2 components. Sizing source lives in src/lib/overlay/v2LayoutContract.ts. */

export {
    OVERLAY_MAX_WORK_AREA_RATIO,
    OVERLAY_MIN_HEIGHT,
    OVERLAY_MIN_WIDTH,
    V2_BAR_ONLY_WIDTH,
    V2_CONTAINER_PADDING,
    V2_INSIGHTS_WIDTH_WIDE as V2_INSIGHTS_WIDTH,
    V2_LAYOUT_BREAKPOINTS,
    V2_OVERLAY_WINDOW_DEFAULT_HEIGHT,
    V2_OVERLAY_WINDOW_MAX_HEIGHT,
    V2_PANEL_GAP,
    V2_RESPONSE_MAX_WIDTH_WIDE as V2_RESPONSE_MAX_WIDTH,
    V2_RESPONSE_MIN_WIDTH_WIDE as V2_RESPONSE_MIN_WIDTH,
    clampNumber,
    getOverlayMaxHeight,
    getOverlayMaxWidth,
    getV2DefaultOverlayWidth,
    resolveV2LayoutMode,
    resolveV2ResponsiveLayout,
    type OverlayLayoutConstraints,
    type V2OverlayLayoutMode,
    type V2ResponsiveLayout,
} from '../../lib/overlay/v2LayoutContract';

import {
    V2_BAR_ONLY_WIDTH,
    V2_CONTAINER_PADDING,
    V2_INSIGHTS_WIDTH_WIDE,
    V2_PANEL_GAP,
    V2_RESPONSE_MAX_WIDTH_WIDE,
    V2_RESPONSE_MIN_WIDTH_WIDE,
} from '../../lib/overlay/v2LayoutContract';

function looksLikeWideSystemDesignResponse(text: string): boolean {
    return /architecture_json/i.test(text)
        || /```[ \t]*(?:architecture_json|mermaid)\b/i.test(text)
        || /\b(?:architecture diagram|system design)\b/i.test(text);
}

export function resolveV2ResponseWidthPx(text?: string): number {
    if (!text?.trim()) return V2_RESPONSE_MIN_WIDTH_WIDE;
    if (looksLikeWideSystemDesignResponse(text)) return V2_RESPONSE_MAX_WIDTH_WIDE;

    const len = text.length;
    let width = V2_RESPONSE_MIN_WIDTH_WIDE;
    if (len > 3000) width = V2_RESPONSE_MAX_WIDTH_WIDE;
    else if (len > 2000) width = 780;
    else if (len > 1200) width = 720;
    else if (len > 600) width = 640;
    else if (len > 300) width = 600;

    const longestLine = text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
    if (longestLine > 72) {
        const lineWidth = Math.min(V2_RESPONSE_MAX_WIDTH_WIDE, 440 + Math.floor(longestLine * 3.6));
        width = Math.max(width, lineWidth);
    }

    return Math.min(V2_RESPONSE_MAX_WIDTH_WIDE, Math.max(V2_RESPONSE_MIN_WIDTH_WIDE, width));
}

export function getV2PanelsWidth(responseWidthPx: number): number {
    return V2_INSIGHTS_WIDTH_WIDE + V2_PANEL_GAP + responseWidthPx + V2_CONTAINER_PADDING;
}

export const V2_PANELS_WIDTH_DEFAULT = getV2PanelsWidth(V2_RESPONSE_MIN_WIDTH_WIDE);
export const V2_PANELS_WIDTH_MAX = getV2PanelsWidth(V2_RESPONSE_MAX_WIDTH_WIDE);

/** Minimum Electron overlay window width when pro v2 layout is active. */
export const V2_OVERLAY_WINDOW_MIN_WIDTH = V2_BAR_ONLY_WIDTH;
