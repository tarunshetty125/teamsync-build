/** Shared pro-v2 overlay layout constants. */

export const V2_INSIGHTS_WIDTH = 380;
export const V2_PANEL_GAP = 7;
export const V2_CONTAINER_PADDING = 32;
export const V2_BAR_ONLY_WIDTH = 600;

export const V2_RESPONSE_MIN_WIDTH = 680;
export const V2_RESPONSE_MAX_WIDTH = 1040;

function looksLikeWideSystemDesignResponse(text: string): boolean {
    return /architecture_json/i.test(text)
        || /```[ \t]*(?:architecture_json|mermaid)\b/i.test(text)
        || /\b(?:architecture diagram|system design)\b/i.test(text);
}

export function resolveV2ResponseWidthPx(text?: string): number {
    if (!text?.trim()) return V2_RESPONSE_MIN_WIDTH;
    if (looksLikeWideSystemDesignResponse(text)) return V2_RESPONSE_MAX_WIDTH;

    const len = text.length;
    let width = V2_RESPONSE_MIN_WIDTH;
    if (len > 3000) width = V2_RESPONSE_MAX_WIDTH;
    else if (len > 2000) width = 900;
    else if (len > 1200) width = 820;
    else if (len > 600) width = 740;
    else if (len > 300) width = 700;

    const longestLine = text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
    if (longestLine > 72) {
        const lineWidth = Math.min(V2_RESPONSE_MAX_WIDTH, 520 + Math.floor(longestLine * 4.8));
        width = Math.max(width, lineWidth);
    }

    return Math.min(V2_RESPONSE_MAX_WIDTH, Math.max(V2_RESPONSE_MIN_WIDTH, width));
}

export function getV2PanelsWidth(responseWidthPx: number): number {
    return V2_INSIGHTS_WIDTH + V2_PANEL_GAP + responseWidthPx + V2_CONTAINER_PADDING;
}

export const V2_PANELS_WIDTH_DEFAULT = getV2PanelsWidth(V2_RESPONSE_MIN_WIDTH);
export const V2_PANELS_WIDTH_MAX = getV2PanelsWidth(V2_RESPONSE_MAX_WIDTH);

/** Minimum Electron overlay window width when pro v2 layout is active. */
export const V2_OVERLAY_WINDOW_MIN_WIDTH = V2_PANELS_WIDTH_MAX;

/** Sensible initial height before the renderer measures content. */
export const V2_OVERLAY_WINDOW_DEFAULT_HEIGHT = 520;
export const V2_OVERLAY_WINDOW_MAX_HEIGHT = 860;
