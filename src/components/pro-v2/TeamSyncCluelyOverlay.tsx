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
import RollingTranscript from '../ui/RollingTranscript';
import { useV2OverlayResize } from './useV2OverlayResize';
import './pro-v2.css';
import {
    getV2PanelsWidth,
    resolveV2ResponseWidthPx,
} from './v2Layout';

function getTranscriptPillText(rollingTranscript: string, lastFinalSentence: string): string {
    const normalizedRolling = rollingTranscript.trim();
    if (normalizedRolling) {
        const segments = normalizedRolling.split('  ·  ').map((segment) => segment.trim()).filter(Boolean);
        if (segments.length > 0) {
            return segments[segments.length - 1];
        }
    }
    return lastFinalSentence.trim();
}

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
    if (!bridge.activeResponse?.isStreaming && bridge.activeResponse?.text) {
        settledResponseTextRef.current = bridge.activeResponse.text;
    }
    const expandedPanelsWidth = useMemo(
        () =>
            getV2PanelsWidth(
                resolveV2ResponseWidthPx(
                    bridge.activeResponse?.isStreaming
                        ? settledResponseTextRef.current
                        : bridge.activeResponse?.text,
                ),
            ),
        [bridge.activeResponse?.text, bridge.activeResponse?.isStreaming],
    );

    const showTranscriptStrip =
        bridge.showTranscript ||
        bridge.sttInterviewerStatus !== 'connected' ||
        bridge.sttUserStatus !== 'connected';

    useV2OverlayResize({
        containerRef,
        panelsRowRef,
        isExpanded: bridge.isExpanded,
        expandedPanelsWidth,
        isMeetingActive: bridge.isMeetingActive,
        showTranscriptStrip,
        isProcessing: bridge.isProcessing,
        contentRevision: [
            showTranscriptStrip,
            bridge.activeQuickActions.length,
            bridge.activeResponse?.id ?? 'none',
            bridge.activeResponse?.text.length ?? 0,
            bridge.activeResponseIndex,
        ].join(':'),
    });

    const handleToggleTranscript = useCallback(() => {
        bridge.setShowTranscript((prev: boolean) => !prev);
    }, [bridge.setShowTranscript]);

    const transcriptPillText = useMemo(
        () => getTranscriptPillText(bridge.rollingTranscript, bridge.lastFinalSentence),
        [bridge.lastFinalSentence, bridge.rollingTranscript],
    );

    return (
        <div
            ref={containerRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
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
                isTranscriptPaused={bridge.isTranscriptPaused}
                meetingStartTime={bridge.meetingStartTime}
                inputValue={bridge.inputValue}
                onToggleExpanded={bridge.toggleExpanded}
                onEndMeeting={bridge.handleEndMeeting}
                onReset={bridge.handleReset}
                onSubmit={bridge.handleManualSubmit}
                onInputChange={bridge.setInputValue}
                onScreenScan={bridge.handleScreenScan}
                onToggleTranscriptPause={bridge.toggleTranscriptPause}
            />

            {/* ── Rolling transcript strip — between bar and panels ── */}
            <AnimatePresence initial={false}>
                {showTranscriptStrip && (
                    <motion.div
                        initial={{ opacity: 0, height: 0, y: 4 }}
                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                        exit={{ opacity: 0, height: 0, y: -2 }}
                        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                            overflow: 'hidden',
                            width: '100%',
                            paddingTop: 6,
                            paddingBottom: 4,
                        }}
                    >
                        <div
                            style={{
                                width: '100%',
                                maxWidth: getV2PanelsWidth(
                                    resolveV2ResponseWidthPx(
                                        bridge.activeResponse?.isStreaming
                                            ? settledResponseTextRef.current
                                            : bridge.activeResponse?.text,
                                    ),
                                ),
                                margin: '0 auto',
                                padding: '0 18px',
                            }}
                        >
                            <RollingTranscript
                                text={bridge.showTranscript ? transcriptPillText : ''}
                                speakerLabel={bridge.showTranscript ? bridge.rollingTranscriptSpeakerLabel : ''}
                                isActive={bridge.isInterviewerSpeaking}
                                aiHasResponded={!bridge.isProcessing}
                                variant="pro-v2"
                                interviewerChannel={{
                                    status: bridge.sttInterviewerStatus as 'connected' | 'reconnecting' | 'failed',
                                    error: bridge.sttInterviewerError,
                                    provider: bridge.sttInterviewerProvider,
                                }}
                                microphoneChannel={{
                                    status: bridge.sttUserStatus as 'connected' | 'reconnecting' | 'failed',
                                    error: bridge.sttUserError,
                                }}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Surfaces 2 & 3: Panels side-by-side ── */}
            <AnimatePresence>
                {bridge.isExpanded && (
                    <motion.div
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
                            activeResponse={bridge.activeResponse}
                            isProcessing={bridge.isProcessing}
                            activeResponseIndex={bridge.activeResponseIndex}
                            responseHistoryTotal={bridge.responseHistoryTotal}
                            canGoPreviousResponse={bridge.canGoPreviousResponse}
                            canGoNextResponse={bridge.canGoNextResponse}
                            onPreviousResponse={bridge.goToPreviousResponse}
                            onNextResponse={bridge.goToNextResponse}
                            scrollContainerRef={bridge.scrollContainerRef}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default TeamSyncCluelyOverlay;
