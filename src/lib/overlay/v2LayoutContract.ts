/** Single source of truth for pro-v2 overlay sizing. */

export type V2OverlayLayoutMode = 'wide' | 'medium' | 'narrow';

export type OverlayDisplayWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OverlayLayoutConstraints = {
  displayId: number;
  scaleFactor: number;
  workArea: OverlayDisplayWorkArea;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  maxWorkAreaRatio: number;
};

export type V2ResponsiveLayout = {
  mode: V2OverlayLayoutMode;
  stacked: boolean;
  windowWidth: number;
  contentWidth: number;
  insightsWidth: number;
  responseWidth: number;
  responseMinWidth: number;
  responseMaxWidth: number;
  panelGap: number;
  horizontalPadding: number;
};

export const OVERLAY_MAX_WORK_AREA_RATIO = 0.9;
export const OVERLAY_MIN_WIDTH = 300;
export const OVERLAY_MIN_HEIGHT = 1;

export const V2_LAYOUT_BREAKPOINTS = {
  wide: 1400,
  medium: 1100,
} as const;

export const V2_INSIGHTS_WIDTH_WIDE = 340;
export const V2_INSIGHTS_WIDTH_MEDIUM = 300;
export const V2_PANEL_GAP = 7;
export const V2_CONTAINER_PADDING = 28;
export const V2_BAR_ONLY_WIDTH = 600;

export const V2_RESPONSE_MIN_WIDTH_WIDE = 560;
export const V2_RESPONSE_MAX_WIDTH_WIDE = 880;
export const V2_RESPONSE_MIN_WIDTH_MEDIUM = 480;
export const V2_RESPONSE_MAX_WIDTH_MEDIUM = 760;
export const V2_STACKED_PANEL_MAX_WIDTH = 720;

export const V2_OVERLAY_WINDOW_DEFAULT_HEIGHT = 780;
export const V2_OVERLAY_WINDOW_MAX_HEIGHT = 1290;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function getOverlayMaxWidth(workAreaWidth: number): number {
  return Math.max(OVERLAY_MIN_WIDTH, Math.floor(workAreaWidth * OVERLAY_MAX_WORK_AREA_RATIO));
}

export function getOverlayMaxHeight(workAreaHeight: number): number {
  return Math.max(OVERLAY_MIN_HEIGHT, Math.floor(workAreaHeight * OVERLAY_MAX_WORK_AREA_RATIO));
}

export function resolveV2LayoutMode(maxWidth: number): V2OverlayLayoutMode {
  if (maxWidth >= V2_LAYOUT_BREAKPOINTS.wide) return 'wide';
  if (maxWidth >= V2_LAYOUT_BREAKPOINTS.medium) return 'medium';
  return 'narrow';
}

export function resolveV2ResponsiveLayout(maxWidth: number): V2ResponsiveLayout {
  const availableWidth = Math.max(OVERLAY_MIN_WIDTH, Math.floor(maxWidth));
  const mode = resolveV2LayoutMode(availableWidth);

  if (mode === 'wide') {
    const responseWidth = Math.min(
      V2_RESPONSE_MAX_WIDTH_WIDE,
      Math.max(
        V2_RESPONSE_MIN_WIDTH_WIDE,
        availableWidth - V2_CONTAINER_PADDING - V2_PANEL_GAP - V2_INSIGHTS_WIDTH_WIDE,
      ),
    );
    const contentWidth = V2_INSIGHTS_WIDTH_WIDE + V2_PANEL_GAP + responseWidth;
    return {
      mode,
      stacked: false,
      windowWidth: Math.min(availableWidth, contentWidth + V2_CONTAINER_PADDING),
      contentWidth,
      insightsWidth: V2_INSIGHTS_WIDTH_WIDE,
      responseWidth,
      responseMinWidth: V2_RESPONSE_MIN_WIDTH_WIDE,
      responseMaxWidth: V2_RESPONSE_MAX_WIDTH_WIDE,
      panelGap: V2_PANEL_GAP,
      horizontalPadding: V2_CONTAINER_PADDING,
    };
  }

  if (mode === 'medium') {
    const responseWidth = Math.min(
      V2_RESPONSE_MAX_WIDTH_MEDIUM,
      Math.max(
        V2_RESPONSE_MIN_WIDTH_MEDIUM,
        availableWidth - V2_CONTAINER_PADDING - V2_PANEL_GAP - V2_INSIGHTS_WIDTH_MEDIUM,
      ),
    );
    const contentWidth = V2_INSIGHTS_WIDTH_MEDIUM + V2_PANEL_GAP + responseWidth;
    return {
      mode,
      stacked: false,
      windowWidth: Math.min(availableWidth, contentWidth + V2_CONTAINER_PADDING),
      contentWidth,
      insightsWidth: V2_INSIGHTS_WIDTH_MEDIUM,
      responseWidth,
      responseMinWidth: V2_RESPONSE_MIN_WIDTH_MEDIUM,
      responseMaxWidth: V2_RESPONSE_MAX_WIDTH_MEDIUM,
      panelGap: V2_PANEL_GAP,
      horizontalPadding: V2_CONTAINER_PADDING,
    };
  }

  const contentWidth = Math.min(
    V2_STACKED_PANEL_MAX_WIDTH,
    Math.max(OVERLAY_MIN_WIDTH, availableWidth - V2_CONTAINER_PADDING),
  );
  return {
    mode,
    stacked: true,
    windowWidth: Math.min(
      availableWidth,
      Math.max(Math.min(V2_BAR_ONLY_WIDTH, availableWidth), contentWidth + V2_CONTAINER_PADDING),
    ),
    contentWidth,
    insightsWidth: contentWidth,
    responseWidth: contentWidth,
    responseMinWidth: Math.min(contentWidth, V2_RESPONSE_MIN_WIDTH_MEDIUM),
    responseMaxWidth: contentWidth,
    panelGap: V2_PANEL_GAP,
    horizontalPadding: V2_CONTAINER_PADDING,
  };
}

export function getV2DefaultOverlayWidth(maxWidth: number): number {
  return resolveV2ResponsiveLayout(maxWidth).windowWidth;
}
