/**
 * ProOverlayControlStrip — v1 overlay controls for pro v2 left panel.
 * Model picker, overlay settings popup, mouse passthrough, custom context.
 */

import React, { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, PointerOff, FileText, Ghost } from 'lucide-react';
import {
    MODEL_PROVIDER_LABELS,
    MODEL_PROVIDER_SHORT_LABELS,
    getModelProviderId,
    getOverlayModelDisplayName,
} from '../../utils/modelUtils';
import { getProviderModelMetadata } from '../../lib/providers/providerModelMetadata';

const POPUP_GAP = 6;

export interface ProOverlayControlStripProps {
    panelRef: React.RefObject<HTMLDivElement | null>;
    currentModel: string;
    isSettingsOpen: boolean;
    isMousePassthrough: boolean;
    overlayOpacity: number;
    customNotesEnabled: boolean;
    hasProContextAccess: boolean;
    onToggleMousePassthrough: () => void;
    onCycleOverlayOpacity: () => void;
    onToggleCustomContext: () => void;
}

const ProOverlayControlStrip = memo<ProOverlayControlStripProps>(function ProOverlayControlStrip({
    panelRef,
    currentModel,
    isSettingsOpen,
    isMousePassthrough,
    overlayOpacity,
    customNotesEnabled,
    hasProContextAccess,
    onToggleMousePassthrough,
    onCycleOverlayOpacity,
    onToggleCustomContext,
}) {
    const openPopupBelowPanel = useCallback((anchorRect: DOMRect) => {
        const panel = panelRef.current;
        if (!panel) return null;
        const panelRect = panel.getBoundingClientRect();
        return {
            x: window.screenX + anchorRect.left,
            y: window.screenY + panelRect.bottom + POPUP_GAP,
        };
    }, [panelRef]);

    const handleModelClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = openPopupBelowPanel(e.currentTarget.getBoundingClientRect());
        if (pos) {
            window.electronAPI?.toggleModelSelector?.(pos);
        }
    }, [openPopupBelowPanel]);

    const handleSettingsClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
        if (isSettingsOpen) {
            window.electronAPI?.toggleSettingsWindow?.();
            return;
        }
        const pos = openPopupBelowPanel(e.currentTarget.getBoundingClientRect());
        if (pos) {
            window.electronAPI?.toggleSettingsWindow?.(pos);
        }
    }, [isSettingsOpen, openPopupBelowPanel]);

    const modelMetadata = getProviderModelMetadata(currentModel, { source: 'runtime' });
    const modelDisplayName = getOverlayModelDisplayName(currentModel);
    const modelProvider = getModelProviderId(currentModel);
    const modelProviderLabel = MODEL_PROVIDER_LABELS[modelProvider];
    const modelProviderShortLabel = MODEL_PROVIDER_SHORT_LABELS[modelProvider];
    const modelStatusLabel = modelMetadata.statusLabel;
    const isOpacityReduced = overlayOpacity < 0.9;
    const opacityLabel = isOpacityReduced ? `Opacity: ${Math.round(overlayOpacity * 100)}%` : 'Opacity: Full';

    return (
        <div className="v2-overlay-controls v2-no-drag">
            <button
                type="button"
                className="v2-overlay-model-btn v2-no-drag"
                onClick={handleModelClick}
                title={`${modelProviderLabel} · ${modelDisplayName}`}
                aria-label={`Change model, current model ${modelDisplayName} from ${modelProviderLabel}, ${modelStatusLabel}`}
            >
                <span className="v2-overlay-model-provider" data-provider={modelProvider} aria-hidden="true">
                    <span className="v2-overlay-model-provider-dot" />
                    <span className="v2-overlay-model-provider-text">
                        {modelProviderShortLabel}
                    </span>
                </span>
                <span className="v2-overlay-model-label">
                    {modelDisplayName}
                </span>
                <span className="v2-overlay-model-status">
                    {modelStatusLabel}
                </span>
                <ChevronDown size={13} className="v2-overlay-model-chevron" />
            </button>

            <div className="v2-overlay-controls-divider" />

            <div className="relative group v2-overlay-control-wrap">
                <button
                    type="button"
                    className={`v2-panel-btn v2-overlay-icon-btn v2-overlay-icon-btn--settings ${isSettingsOpen ? 'v2-overlay-icon-btn--active' : ''}`}
                    onClick={handleSettingsClick}
                    aria-pressed={isSettingsOpen}
                    aria-label="Open overlay settings"
                >
                    <SlidersHorizontal size={14} />
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Settings
                </div>
            </div>

            <div className="relative group v2-overlay-control-wrap">
                <button
                    type="button"
                    className={`v2-panel-btn v2-overlay-icon-btn ${isOpacityReduced ? 'v2-overlay-icon-btn--opacity' : ''}`}
                    onClick={onCycleOverlayOpacity}
                    aria-pressed={isOpacityReduced}
                    aria-label={opacityLabel}
                >
                    <Ghost size={14} className={isOpacityReduced ? 'animate-flame-purple' : ''} />
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {opacityLabel}
                </div>
            </div>

            <div className="relative group v2-overlay-control-wrap">
                <button
                    type="button"
                    className={`v2-panel-btn v2-overlay-icon-btn ${isMousePassthrough ? 'v2-overlay-icon-btn--passthrough' : ''}`}
                    onClick={onToggleMousePassthrough}
                    aria-pressed={isMousePassthrough}
                    aria-label={`Mouse passthrough ${isMousePassthrough ? 'on' : 'off'}`}
                >
                    <PointerOff size={14} className={isMousePassthrough ? 'animate-flame-blue' : ''} />
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Mouse Passthrough: {isMousePassthrough ? 'ON' : 'OFF'}
                </div>
            </div>

            {hasProContextAccess && (
                <div className="relative group v2-overlay-control-wrap">
                    <button
                        type="button"
                        className={`v2-panel-btn v2-overlay-icon-btn ${customNotesEnabled ? 'v2-overlay-icon-btn--context' : ''}`}
                        onClick={onToggleCustomContext}
                        aria-pressed={customNotesEnabled}
                        aria-label={`Custom context ${customNotesEnabled ? 'on' : 'off'}`}
                    >
                        <FileText size={14} className={customNotesEnabled ? 'animate-flame-yellow' : ''} />
                    </button>
                    <div className="absolute top-full right-0 mt-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                        Custom context: {customNotesEnabled ? 'ON' : 'OFF'}
                    </div>
                </div>
            )}
        </div>
    );
});

export default ProOverlayControlStrip;
