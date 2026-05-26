/**
 * TeamSyncCluelyOverlay.tsx — V2 Top-Level Shell
 *
 * Layout: Bar → Rolling transcript strip → Two panels side-by-side
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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

    const settledResponseTextRef = useRef<string | undefined>();
    if (!bridge.latestResponse?.isStreaming && bridge.latestResponse?.text) {
        settledResponseTextRef.current = bridge.latestResponse.text;
    }
    const expandedPanelsWidth = useMemo(
        () =>
            getV2PanelsWidth(
                resolveV2ResponseWidthPx(
                    bridge.latestResponse?.isStreaming
                        ? settledResponseTextRef.current
                        : bridge.latestResponse?.text,
                ),
            ),
        [bridge.latestResponse?.text, bridge.latestResponse?.isStreaming],
    );

    useV2OverlayResize({
        containerRef,
        panelsRowRef,
        isExpanded: bridge.isExpanded,
        expandedPanelsWidth,
        isMeetingActive: bridge.isMeetingActive,
        showTranscript: bridge.showTranscript,
        isProcessing: bridge.isProcessing,
        contentRevision: `${bridge.showTranscript}-${bridge.activeQuickActions.length}`,
    });

    const handleToggleTranscript = useCallback(() => {
        bridge.setShowTranscript((prev: boolean) => !prev);
    }, [bridge.setShowTranscript]);

    const transcriptLines = bridge.rollingTranscript
        ? bridge.rollingTranscript.split('  ·  ').filter(Boolean)
        : [];

    return (
        <div
            ref={containerRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: 'fit-content',
                margin: '0 auto',
                padding: '28px 8px 8px',
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

            {/* ── Rolling transcript strip — between bar and panels ── */}
            <AnimatePresence initial={false}>
                {bridge.showTranscript && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, y: 4 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -2 }}
                        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                            overflow: 'hidden',
                            width: '100%',
                            paddingTop: transcriptLines.length ? 6 : 4,
                        }}
                    >
                        <div
                            className="v2-scroll-area"
                            style={{
                                maxHeight: 120,
                                padding: '0 18px 8px',
                                display: 'flex',
                                justifyContent: 'center',
                            }}
                        >
                            <div
                                className="v2-transcript-body"
                                style={{
                                    maxWidth: getV2PanelsWidth(
                                        resolveV2ResponseWidthPx(
                                            bridge.latestResponse?.isStreaming
                                                ? settledResponseTextRef.current
                                                : bridge.latestResponse?.text,
                                        ),
                                    ),
                                }}
                            >
                                {transcriptLines.length > 0 ? (
                                    transcriptLines.map((line, index) => (
                                        <div
                                            key={`${index}-${line.slice(0, 24)}`}
                                            className="v2-transcript-line"
                                        >
                                            {line}
                                        </div>
                                    ))
                                ) : (
                                    <span style={{ fontStyle: 'italic', opacity: 0.7 }}>
                                        Listening…
                                    </span>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Surfaces 2 & 3: Panels side-by-side ── */}
            <AnimatePresence>
                {bridge.isExpanded && (
                    <div
                        ref={panelsRowRef}
                        className="v2-panels-row"
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
