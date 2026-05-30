/**
 * ProOverlayControlStrip — v1 overlay controls for pro v2 left panel.
 * Model picker, overlay settings popup, mouse passthrough, custom context.
 */

import React, { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, PointerOff, FileText } from 'lucide-react';
import { getOverlayModelDisplayName } from '../../utils/modelUtils';

const POPUP_GAP = 8;

export interface ProOverlayControlStripProps {
    panelRef: React.RefObject<HTMLDivElement | null>;
    currentModel: string;
    isSettingsOpen: boolean;
    isMousePassthrough: boolean;
    customNotesEnabled: boolean;
    hasProContextAccess: boolean;
    onToggleMousePassthrough: () => void;
    onToggleCustomContext: () => void;
}

const ProOverlayControlStrip = memo<ProOverlayControlStripProps>(function ProOverlayControlStrip({
    panelRef,
    currentModel,
    isSettingsOpen,
    isMousePassthrough,
    customNotesEnabled,
    hasProContextAccess,
    onToggleMousePassthrough,
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

    const modelDisplayName = getOverlayModelDisplayName(currentModel);

    return (
        <div className="v2-overlay-controls v2-no-drag">
            <button
                type="button"
                className="v2-overlay-model-btn"
                onClick={handleModelClick}
                title={modelDisplayName}
                aria-label={`Change model, current model ${modelDisplayName}`}
            >
                <span className="v2-overlay-model-label">
                    {modelDisplayName}
                </span>
                <ChevronDown size={13} className="v2-overlay-model-chevron" />
            </button>

            <div className="v2-overlay-controls-divider" />

            <div className="relative group">
                <button
                    type="button"
                    className={`v2-panel-btn v2-overlay-icon-btn ${isSettingsOpen ? 'v2-overlay-icon-btn--active' : ''}`}
                    onClick={handleSettingsClick}
                >
                    <SlidersHorizontal size={14} />
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Settings
                </div>
            </div>

            <div className="relative group">
                <button
                    type="button"
                    className={`v2-panel-btn v2-overlay-icon-btn ${isMousePassthrough ? 'v2-overlay-icon-btn--passthrough' : ''}`}
                    onClick={onToggleMousePassthrough}
                >
                    <PointerOff size={14} className={isMousePassthrough ? 'animate-flame-blue' : ''} />
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Mouse Passthrough: {isMousePassthrough ? 'ON' : 'OFF'}
                </div>
            </div>

            {hasProContextAccess && (
                <div className="relative group">
                    <button
                        type="button"
                        className={`v2-panel-btn v2-overlay-icon-btn ${customNotesEnabled ? 'v2-overlay-icon-btn--context' : ''}`}
                        onClick={onToggleCustomContext}
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
