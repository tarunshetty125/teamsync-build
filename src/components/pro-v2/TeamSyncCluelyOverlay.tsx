/**
 * TeamSyncCluelyOverlay.tsx — V2 Top-Level Shell
 *
 * Layout: Bar → Rolling transcript strip → Two panels side-by-side
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCluelyOverlayBridge } from './useCluelyOverlayBridge';
import ProFloatingBar from './ProFloatingBar';
import ProInsightsPanel from './ProInsightsPanel';
import ProResponseSurface from './ProResponseSurface';
import RollingTranscript from '../ui/RollingTranscript';

import { useV2OverlayResize } from './useV2OverlayResize';
import { Image as ImageIcon, X } from 'lucide-react';
import { OVERLAY_OPACITY_MIN } from '../../lib/overlayAppearance';
import './pro-v2.css';
import './glass.css';
import {
    OVERLAY_MAX_WORK_AREA_RATIO,
    OVERLAY_MIN_HEIGHT,
    OVERLAY_MIN_WIDTH,
    getOverlayMaxHeight,
    getOverlayMaxWidth,
    resolveV2ResponsiveLayout,
    type OverlayLayoutConstraints,
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

interface ProAttachmentStripProps {
    attachments: Array<{ path: string; preview: string }>;
    mode: 'pending' | 'active';
    onRemove?: (index: number) => void;
    onClear?: () => void;
}

const ProAttachmentStrip: React.FC<ProAttachmentStripProps> = ({
    attachments,
    mode,
    onRemove,
    onClear,
}) => {
    if (attachments.length === 0) return null;
    const isPending = mode === 'pending';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0, overflow: 'hidden' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="v2-attachment-strip v2-no-drag"
        >
            <div className="v2-attachment-strip__meta">
                <ImageIcon size={12} strokeWidth={2} />
                <span>
                    {isPending
                        ? `${attachments.length} screenshot${attachments.length > 1 ? 's' : ''} attached`
                        : 'Screenshot analyzed'}
                </span>
            </div>
            <div className="v2-attachment-strip__rail">
                <AnimatePresence initial={false}>
                    {attachments.map((attachment, index) => (
                        <motion.div
                            layout
                            key={attachment.path}
                            initial={{ opacity: 0, scale: 0.6, width: 0 }}
                            animate={{ opacity: 1, scale: 1, width: 32 }}
                            exit={{ opacity: 0, scale: 0.5, width: 0, marginRight: 0 }}
                            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                            style={{ overflow: 'hidden' }}
                            className="v2-attachment-thumb"
                        >
                            {attachment.preview ? (
                                <img src={attachment.preview} alt={`Screenshot ${index + 1}`} />
                            ) : (
                                <div className="v2-attachment-thumb__empty">
                                    <ImageIcon size={15} strokeWidth={1.8} />
                                </div>
                            )}
                            {isPending && onRemove && (
                                <button
                                    type="button"
                                    className="v2-attachment-thumb__remove"
                                    onClick={() => onRemove(index)}
                                    aria-label="Remove screenshot"
                                    title="Remove screenshot"
                                >
                                    <X size={10} strokeWidth={2.4} />
                                </button>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
            {isPending && attachments.length > 1 && onClear && (
                <button
                    type="button"
                    className="v2-attachment-strip__clear"
                    onClick={onClear}
                >
                    Clear
                </button>
            )}
        </motion.div>
    );
};

function getRendererFallbackConstraints(): OverlayLayoutConstraints {
    const width = window.screen?.availWidth || window.innerWidth || 1200;
    const height = window.screen?.availHeight || window.innerHeight || 800;
    return {
        displayId: -1,
        scaleFactor: window.devicePixelRatio || 1,
        workArea: { x: 0, y: 0, width, height },
        maxWidth: getOverlayMaxWidth(width),
        maxHeight: getOverlayMaxHeight(height),
        minWidth: OVERLAY_MIN_WIDTH,
        minHeight: OVERLAY_MIN_HEIGHT,
        maxWorkAreaRatio: OVERLAY_MAX_WORK_AREA_RATIO,
    };
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
    const [overlayConstraints, setOverlayConstraints] = React.useState<OverlayLayoutConstraints | null>(null);

    useEffect(() => {
        let disposed = false;
        const applyConstraints = (constraints: OverlayLayoutConstraints) => {
            if (!disposed) setOverlayConstraints(constraints);
        };

        if (window.electronAPI?.getOverlayLayoutConstraints) {
            window.electronAPI.getOverlayLayoutConstraints()
                .then(applyConstraints)
                .catch(() => applyConstraints(getRendererFallbackConstraints()));
        } else {
            applyConstraints(getRendererFallbackConstraints());
        }

        const unsubscribe = window.electronAPI?.onOverlayLayoutConstraintsChanged?.(applyConstraints);
        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);

    const responsiveLayout = useMemo(
        () => resolveV2ResponsiveLayout((overlayConstraints ?? getRendererFallbackConstraints()).maxWidth),
        [overlayConstraints],
    );

    const showTranscriptStrip =
        bridge.showTranscript ||
        bridge.sttInterviewerStatus !== 'connected' ||
        bridge.sttUserStatus !== 'connected';
    const activeResponseContentRevision = bridge.activeResponse?.isStreaming
        ? 'streaming'
        : bridge.activeResponse?.text.length ?? 0;
    const activeResponseAttachment = useMemo(
        () => bridge.activeResponse?.screenshotPreview
            ? [{ path: bridge.activeResponse.requestId ?? bridge.activeResponse.id, preview: bridge.activeResponse.screenshotPreview }]
            : [],
        [bridge.activeResponse?.id, bridge.activeResponse?.requestId, bridge.activeResponse?.screenshotPreview],
    );
    const attachmentStripItems = bridge.attachedContext.length > 0
        ? bridge.attachedContext
        : activeResponseAttachment;
    const attachmentStripMode = bridge.attachedContext.length > 0 ? 'pending' : 'active';

    useV2OverlayResize({
        containerRef,
        panelsRowRef,
        isExpanded: bridge.isExpanded,
        layout: responsiveLayout,
        constraints: overlayConstraints,
        isMeetingActive: bridge.isMeetingActive,
        showTranscriptStrip,
        isProcessing: bridge.isProcessing,
        contentRevision: [
            responsiveLayout.mode,
            showTranscriptStrip,
            bridge.activeQuickActions.length,
            bridge.activeResponse?.id ?? 'none',
            activeResponseContentRevision,
            bridge.activeResponseIndex,
            bridge.attachedContext.map((attachment) => attachment.path).join(','),
            bridge.activeResponse?.screenshotPreview ? 'response-image' : 'no-response-image',
        ].join(':'),
    });

    const handleToggleTranscript = useCallback(() => {
        bridge.setShowTranscript((prev: boolean) => !prev);
    }, [bridge.setShowTranscript]);

    const handleCycleOverlayOpacity = useCallback(() => {
        const currentOpacity = Number.isFinite(bridge.overlayOpacity) ? bridge.overlayOpacity : 1;
        const rounded = Math.round(currentOpacity * 100);
        let nextOpacity = 1.0;

        if (rounded >= 90) nextOpacity = 0.6;
        else if (rounded >= 50) nextOpacity = OVERLAY_OPACITY_MIN;

        window.electronAPI?.setOverlayOpacity?.(nextOpacity);
    }, [bridge.overlayOpacity]);

    const handleOpenLauncher = useCallback(() => {
        window.electronAPI?.setWindowMode?.('launcher');
    }, []);

    const transcriptPillText = useMemo(
        () => getTranscriptPillText(bridge.rollingTranscript, bridge.lastFinalSentence),
        [bridge.lastFinalSentence, bridge.rollingTranscript],
    );
    const visualOverlayOpacity = Number.isFinite(bridge.overlayOpacity) ? bridge.overlayOpacity : 1;

    return (
        <div
            ref={containerRef}
            style={{
                ['--v2-content-max-width' as '--v2-content-max-width']: `${responsiveLayout.contentWidth}px`,
                ['--v2-panel-gap' as '--v2-panel-gap']: `${responsiveLayout.panelGap}px`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                maxHeight: '100vh',
                margin: '0 auto',
                padding: '28px 8px 8px',
                minHeight: 0,
                overflow: 'hidden',
                background: 'transparent',
                opacity: visualOverlayOpacity,
                transition: 'opacity 180ms ease',
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
            } as React.CSSProperties}
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
                onOpenLauncher={handleOpenLauncher}
                hasAttachments={bridge.attachedContext.length > 0}
            />

            <AnimatePresence initial={false}>
                {attachmentStripItems.length > 0 && (
                    <ProAttachmentStrip
                        attachments={attachmentStripItems}
                        mode={attachmentStripMode}
                        onRemove={bridge.removeAttachedContextAt}
                        onClear={bridge.clearAttachedContext}
                    />
                )}
            </AnimatePresence>

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
                                maxWidth: responsiveLayout.contentWidth,
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
                        className={`v2-panels-row v2-panels-row--${responsiveLayout.mode}`}
                        style={{
                            width: responsiveLayout.contentWidth,
                            maxWidth: '100%',
                            gap: responsiveLayout.panelGap,
                            flex: '1 1 auto',
                            minHeight: 0,
                            overflow: 'hidden',
                            flexDirection: responsiveLayout.stacked ? 'column' : 'row',
                            alignItems: responsiveLayout.stacked ? 'stretch' : 'stretch',
                        }}
                    >
                        <ProInsightsPanel
                            widthPx={responsiveLayout.insightsWidth}
                            contextSummary={bridge.contextSummary}
                            activeQuickActions={bridge.activeQuickActions}
                            recommendedButton={bridge.recommendedButton}
                            overlayCopilotMode={bridge.overlayCopilotMode}
                            lastFinalSentence={bridge.lastFinalSentence}
                            rollingTranscript={bridge.rollingTranscript}
                            rollingTranscriptSpeakerLabel={bridge.rollingTranscriptSpeakerLabel}
                            isInterviewerSpeaking={bridge.isInterviewerSpeaking}
                            showTranscript={bridge.showTranscript}
                            contextPreviewByActionId={bridge.contextPreviewByActionId}
                            onToggleTranscript={handleToggleTranscript}
                            getQuickActionHandler={bridge.getQuickActionHandler}
                            currentModel={bridge.currentModel}
                            isSettingsOpen={bridge.isSettingsOpen}
                            isMousePassthrough={bridge.isMousePassthrough}
                            overlayOpacity={bridge.overlayOpacity}
                            customNotesEnabled={bridge.customNotesEnabled}
                            hasProContextAccess={bridge.hasProContextAccess}
                            onToggleMousePassthrough={bridge.toggleMousePassthrough}
                            onCycleOverlayOpacity={handleCycleOverlayOpacity}
                            onToggleCustomContext={bridge.toggleCustomContext}
                        />

                        <ProResponseSurface
                            widthPx={responsiveLayout.responseWidth}
                            minWidthPx={responsiveLayout.responseMinWidth}
                            maxWidthPx={responsiveLayout.responseMaxWidth}
                            activeResponse={bridge.activeResponse}
                            responseHistory={bridge.responseHistory}
                            activeResponseChain={bridge.activeResponseChain}
                            isProcessing={bridge.isProcessing}
                            activeResponseIndex={bridge.activeResponseIndex}
                            responseHistoryTotal={bridge.responseHistoryTotal}
                            selectionMode={bridge.selectionMode}
                            canGoPreviousResponse={bridge.canGoPreviousResponse}
                            canGoNextResponse={bridge.canGoNextResponse}
                            canJumpLatestResponse={bridge.canJumpLatestResponse}
                            onPreviousResponse={bridge.goToPreviousResponse}
                            onNextResponse={bridge.goToNextResponse}
                            onJumpLatestResponse={bridge.jumpToLatestResponse}
                            onSelectTimelineResponse={bridge.selectResponseFromTimeline}
                            scrollContainerRef={bridge.scrollContainerRef}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default TeamSyncCluelyOverlay;
