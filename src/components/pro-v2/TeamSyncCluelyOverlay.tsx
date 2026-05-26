/**
 * TeamSyncCluelyOverlay.tsx — V2 Top-Level Shell
 * 
 * Layout: Bar → Transcript pill (togglable) → Two panels side-by-side
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCluelyOverlayBridge } from './useCluelyOverlayBridge';
import ProFloatingBar from './ProFloatingBar';
import ProInsightsPanel from './ProInsightsPanel';
import ProResponseSurface from './ProResponseSurface';
import { useV2OverlayResize } from './useV2OverlayResize';
import './pro-v2.css';
import {
    getV2PanelsWidth,
    resolveV2ResponseWidthPx,
} from './v2Layout';

interface TeamSyncCluelyOverlayProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
    hasProContextAccess?: boolean;
}

const TeamSyncCluelyOverlay: React.FC<TeamSyncCluelyOverlayProps> = ({
    onEndMeeting,
    overlayOpacity,
    hasProContextAccess,
}) => {
    const bridge = useCluelyOverlayBridge({
        onEndMeeting,
        overlayOpacity,
        hasProContextAccess,
    });

    // Register pro-v2 layout with main only while this shell is mounted (v1 stays on 600px defaults).
    useEffect(() => {
        window.electronAPI?.setOverlayV2Layout?.(true).catch(() => { });
        return () => {
            window.electronAPI?.setOverlayV2Layout?.(false).catch(() => { });
        };
    }, []);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const panelsRowRef = React.useRef<HTMLDivElement>(null);

    const expandedPanelsWidth = useMemo(
        () => getV2PanelsWidth(resolveV2ResponseWidthPx(bridge.latestResponse?.text)),
        [bridge.latestResponse?.text],
    );

    useV2OverlayResize({
        containerRef,
        panelsRowRef,
        isExpanded: bridge.isExpanded,
        expandedPanelsWidth,
        isMeetingActive: bridge.isMeetingActive,
        contentRevision: `${bridge.showTranscript}-${bridge.latestResponse?.text?.length ?? 0}-${bridge.activeQuickActions.length}`,
    });

    const handleToggleTranscript = useCallback(() => {
        bridge.setShowTranscript((prev: boolean) => !prev);
    }, [bridge.setShowTranscript]);

    // Latest transcript line for the pill
    const latestTranscriptLine = useMemo(() => {
        if (!bridge.rollingTranscript) return '';
        const lines = bridge.rollingTranscript.split('  ·  ').filter(Boolean);
        return lines.length > 0 ? lines[lines.length - 1].trim() : '';
    }, [bridge.rollingTranscript]);

    return (
        <div
            ref={containerRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: 'fit-content',
                margin: '0 auto',
                padding: '8px',
                minHeight: 0,
                background: 'transparent',
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
            }}
        >
            {/* ── Surface 1: Floating Command Bar ── */}
            <ProFloatingBar
                isExpanded={bridge.isExpanded}
                isProcessing={bridge.isProcessing}
                isMeetingActive={bridge.isMeetingActive}
                meetingStartTime={bridge.meetingStartTime}
                inputValue={bridge.inputValue}
                onToggleExpanded={bridge.toggleExpanded}
                onEndMeeting={bridge.handleEndMeeting}
                onReset={bridge.handleReset}
                onSubmit={bridge.handleManualSubmit}
                onInputChange={bridge.setInputValue}
                onScreenScan={bridge.handleScreenScan}
            />

            {/* ── Transcript Pill (compact, between bar and panels) ── */}
            <AnimatePresence>
                {bridge.showTranscript && bridge.isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: 6 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                            overflow: 'hidden',
                            width: '100%',
                            maxWidth: `${expandedPanelsWidth - 24}px`,
                        }}
                    >
                        <div
                            className="v2-no-drag"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 14px',
                                borderRadius: '999px',
                                background: 'rgba(18, 18, 24, 0.75)',
                                backdropFilter: 'blur(16px)',
                                WebkitBackdropFilter: 'blur(16px)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                        >
                            {/* Live dot */}
                            <span style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: bridge.isInterviewerSpeaking
                                    ? 'rgba(52, 211, 153, 0.85)'
                                    : 'rgba(148, 163, 184, 0.45)',
                                flexShrink: 0,
                                animation: bridge.isInterviewerSpeaking
                                    ? 'v2-dot-pulse 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite'
                                    : 'none',
                            }} />

                            {/* Speaker label */}
                            {bridge.rollingTranscriptSpeakerLabel && (
                                <span style={{
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase' as const,
                                    color: 'rgba(255, 255, 255, 0.30)',
                                    flexShrink: 0,
                                }}>
                                    {bridge.rollingTranscriptSpeakerLabel}
                                </span>
                            )}

                            {/* Latest transcript text — single line, truncated */}
                            <span style={{
                                fontSize: '12px',
                                color: 'rgba(255, 255, 255, 0.55)',
                                fontStyle: 'italic',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                flex: 1,
                                minWidth: 0,
                            }}>
                                {latestTranscriptLine
                                    ? `"${latestTranscriptLine}"`
                                    : 'Listening…'
                                }
                            </span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Surfaces 2 & 3: Panels side-by-side ── */}
            <AnimatePresence>
                {bridge.isExpanded && (
                    <div
                        ref={panelsRowRef}
                        style={{
                            display: 'flex',
                            gap: '6px',
                            marginTop: '6px',
                            alignItems: 'flex-start',
                            width: 'max-content',
                        }}
                    >
                        <ProInsightsPanel
                            contextSummary={bridge.contextSummary}
                            activeQuickActions={bridge.activeQuickActions}
                            recommendedButton={bridge.recommendedButton}
                            overlayCopilotMode={bridge.overlayCopilotMode}
                            lastFinalSentence={bridge.lastFinalSentence}
                            rollingTranscript={bridge.rollingTranscript}
                            rollingTranscriptSpeakerLabel={bridge.rollingTranscriptSpeakerLabel}
                            isInterviewerSpeaking={bridge.isInterviewerSpeaking}
                            showTranscript={bridge.showTranscript}
                            onToggleTranscript={handleToggleTranscript}
                            getQuickActionHandler={bridge.getQuickActionHandler}
                            currentModel={bridge.currentModel}
                            isSettingsOpen={bridge.isSettingsOpen}
                            isMousePassthrough={bridge.isMousePassthrough}
                            customNotesEnabled={bridge.customNotesEnabled}
                            hasProContextAccess={bridge.hasProContextAccess}
                            onToggleMousePassthrough={bridge.toggleMousePassthrough}
                            onToggleCustomContext={bridge.toggleCustomContext}
                        />

                        <ProResponseSurface
                            latestResponse={bridge.latestResponse}
                            isProcessing={bridge.isProcessing}
                            scrollContainerRef={bridge.scrollContainerRef}
                        />
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default TeamSyncCluelyOverlay;
