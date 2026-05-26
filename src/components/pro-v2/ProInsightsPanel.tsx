/**
 * ProInsightsPanel.tsx — Surface 2
 * 
 * Live intelligence panel (left, 290px).
 * Fixed: header, context summary, contextual actions.
 * Scrollable: transcript section only (below actions).
 */

import React, { memo, useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles,
    FileText,
    HelpCircle,
    Brain,
    ArrowRight,
    Info,
    Zap,
    Timer,
    ShieldAlert,
    LifeBuoy,
    BadgeDollarSign,
    Compass,
    Handshake,
    BookOpen,
    Star,
    MessageCircle,
    ThumbsUp,
    Flag,
    Search,
    FileCheck,
    CheckCircle2,
    CheckSquare,
    AlertTriangle,
    User,
    Award,
    Briefcase,
    Volume2,
    TrendingUp,
    Scale,
    SearchCode
} from 'lucide-react';
import type { OverlayQuickActionDef, OverlayRecommendationId } from '../../lib/modes/overlayCopilotConfig';
import ProOverlayControlStrip from './ProOverlayControlStrip';

const ACTION_ICONS: Record<string, React.ReactNode> = {
    // General / Core
    what_to_answer: <Sparkles size={14} className="text-violet-400" />,
    recap: <FileText size={14} className="text-emerald-400" />,
    clarify: <HelpCircle size={14} className="text-sky-400" />,
    brainstorm: <Brain size={14} className="text-pink-400" />,
    follow_up_questions: <ArrowRight size={14} className="text-blue-400" />,
    
    // Tech mode
    tech_hint: <Info size={14} className="text-indigo-400" />,
    tech_optimal_solution: <Zap size={14} className="text-amber-400" />,
    tech_complexity: <Timer size={14} className="text-rose-400" />,
    tech_edge_case: <ShieldAlert size={14} className="text-orange-400" />,
    
    // Sales mode
    sales_objection: <LifeBuoy size={14} className="text-red-400" />,
    sales_pricing: <BadgeDollarSign size={14} className="text-emerald-400" />,
    sales_discovery: <Compass size={14} className="text-cyan-400" />,
    sales_negotiation: <Handshake size={14} className="text-yellow-400" />,
    
    // Lecture mode
    lecture_explain: <BookOpen size={14} className="text-blue-400" />,
    lecture_summary: <FileText size={14} className="text-teal-400" />,
    lecture_takeaway: <Star size={14} className="text-amber-400" />,
    lecture_question: <MessageCircle size={14} className="text-purple-400" />,
    
    // Recruiting mode
    recruiting_strength: <ThumbsUp size={14} className="text-green-400" />,
    recruiting_red_flag: <Flag size={14} className="text-red-400" />,
    recruiting_follow_up: <Search size={14} className="text-sky-400" />,
    recruiting_evaluation: <FileCheck size={14} className="text-indigo-400" />,

    // Team meeting mode
    team_decision: <CheckCircle2 size={14} className="text-emerald-400" />,
    team_action_item: <CheckSquare size={14} className="text-blue-400" />,
    team_risk: <AlertTriangle size={14} className="text-orange-400" />,
    team_owner: <User size={14} className="text-purple-400" />,

    // Job Prep / STAR mode
    job_star: <Award size={14} className="text-amber-400" />,
    job_resume_alignment: <Briefcase size={14} className="text-sky-400" />,
    job_confidence: <Volume2 size={14} className="text-violet-400" />,
    job_improvement: <TrendingUp size={14} className="text-emerald-400" />,

    // System Design mode
    system_tradeoffs: <Scale size={14} className="text-rose-400" />,
    system_clarify: <HelpCircle size={14} className="text-sky-400" />,
    system_approaches: <Brain size={14} className="text-pink-400" />,
    system_deep_dive: <SearchCode size={14} className="text-violet-400" />,
};

const getActionIcon = (action: OverlayQuickActionDef) => {
    return ACTION_ICONS[action.id] || <span style={{ fontSize: '12px' }}>{action.icon}</span>;
};

interface ProInsightsPanelProps {
    currentModel: string;
    isSettingsOpen: boolean;
    isMousePassthrough: boolean;
    customNotesEnabled: boolean;
    hasProContextAccess: boolean;
    onToggleMousePassthrough: () => void;
    onToggleCustomContext: () => void;
    contextSummary: { label: string; detail: string };
    activeQuickActions: OverlayQuickActionDef[];
    recommendedButton: OverlayRecommendationId;
    overlayCopilotMode: string;
    lastFinalSentence: string;
    rollingTranscript: string;
    rollingTranscriptSpeakerLabel: string;
    isInterviewerSpeaking: boolean;
    showTranscript: boolean;
    onToggleTranscript: () => void;
    getQuickActionHandler: (action: OverlayQuickActionDef) => () => void | Promise<void>;
}

const ProInsightsPanel = memo<ProInsightsPanelProps>(function ProInsightsPanel({
    contextSummary,
    activeQuickActions,
    recommendedButton,
    overlayCopilotMode,
    lastFinalSentence,
    rollingTranscript,
    rollingTranscriptSpeakerLabel: _rollingTranscriptSpeakerLabel,
    isInterviewerSpeaking: _isInterviewerSpeaking,
    showTranscript,
    onToggleTranscript,
    getQuickActionHandler,
    currentModel,
    isSettingsOpen,
    isMousePassthrough,
    customNotesEnabled,
    hasProContextAccess,
    onToggleMousePassthrough,
    onToggleCustomContext,
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [copiedText, setCopiedText] = useState(false);

    const handleCopy = useCallback(() => {
        const text = rollingTranscript || lastFinalSentence || 'No transcript available';
        navigator.clipboard.writeText(text).catch(() => {});
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2000);
    }, [rollingTranscript, lastFinalSentence]);

    // Split transcript into displayable lines
    const transcriptLines = rollingTranscript
        ? rollingTranscript.split('  ·  ').filter(Boolean)
        : [];

    return (
        <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
            className="v2-surface-insights v2-no-drag"
            style={{
                width: '320px',
                display: 'flex',
                flexDirection: 'column',
                willChange: 'transform, opacity',
            }}
        >
            <ProOverlayControlStrip
                panelRef={panelRef}
                currentModel={currentModel}
                isSettingsOpen={isSettingsOpen}
                isMousePassthrough={isMousePassthrough}
                customNotesEnabled={customNotesEnabled}
                hasProContextAccess={hasProContextAccess}
                onToggleMousePassthrough={onToggleMousePassthrough}
                onToggleCustomContext={onToggleCustomContext}
            />

            {/* ── Header ── */}
            <div className="v2-panel-header">
                <div className="v2-panel-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    Live insights
                </div>
                <div className="v2-panel-actions">
                    <button
                        className={`v2-transcript-toggle ${showTranscript ? 'v2-transcript-toggle--active' : ''}`}
                        onClick={onToggleTranscript}
                    >
                        {showTranscript ? 'Hide transcript' : 'Show transcript'}
                    </button>
                    <button
                        className="v2-panel-btn"
                        onClick={handleCopy}
                        title="Copy transcript"
                    >
                        {copiedText ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* ── Context Summary (fixed) ── */}
            <div style={{ padding: '0 14px 10px' }}>
                <div className="v2-context-summary">
                    <div className="v2-context-label">{contextSummary.label}</div>
                    <div className="v2-context-detail">{contextSummary.detail}</div>
                </div>
            </div>

            {/* ── Actions (fixed, always visible) ── */}
            <div style={{ padding: '0 8px 8px', flexShrink: 0 }}>
                <div className="v2-section-header">Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {activeQuickActions.map((action, idx) => (
                        <motion.button
                            key={`${overlayCopilotMode}-${action.id}`}
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{
                                duration: 0.18,
                                delay: idx * 0.04,
                                ease: [0.22, 1, 0.36, 1]
                            }}
                            onClick={() => getQuickActionHandler(action)()}
                            className={`v2-action-row ${
                                action.id === recommendedButton ? 'v2-action-row--recommended' : ''
                            }`}
                            style={{ width: '100%', border: 'none', background: action.id === recommendedButton ? undefined : 'transparent' }}
                        >
                            <span className="v2-action-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px' }}>
                                {getActionIcon(action)}
                            </span>
                            <span className="v2-action-label">{action.label}</span>
                        </motion.button>
                    ))}
                </div>
                {activeQuickActions.length === 0 && (
                    <div style={{
                        fontSize: '12px',
                        color: 'rgba(255,255,255,0.30)',
                        padding: '12px',
                        textAlign: 'center',
                        fontStyle: 'italic',
                    }}>
                        Waiting for signals…
                    </div>
                )}
            </div>

            {/* ── Transcript (below summary + actions) ── */}
            <AnimatePresence initial={false}>
                {showTranscript && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        style={{ overflow: 'hidden', flexShrink: 0 }}
                    >
                        <div className="v2-section-header" style={{ padding: '4px 14px 6px' }}>
                            Transcript
                        </div>
                        <div
                            className="v2-scroll-area"
                            style={{
                                maxHeight: '140px',
                                padding: '0 14px 12px',
                                fontSize: '12px',
                                lineHeight: 1.55,
                                color: 'rgba(255, 255, 255, 0.55)',
                            }}
                        >
                            {transcriptLines.length > 0 ? (
                                transcriptLines.map((line, i) => (
                                    <div
                                        key={`${i}-${line.slice(0, 24)}`}
                                        style={{
                                            marginBottom: i < transcriptLines.length - 1 ? '6px' : 0,
                                        }}
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
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});

export default ProInsightsPanel;
