/**
 * ProInsightsPanel.tsx — Surface 2
 *
 * Live intelligence panel (left, 290px).
 * Fixed: header, context summary, contextual actions.
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
    SearchCode,
    DollarSign,
    Anchor
} from 'lucide-react';
import type { OverlayQuickActionDef, OverlayQuickActionId } from '../../lib/modes/overlayCopilotConfig';
import ProOverlayControlStrip from './ProOverlayControlStrip';
import { V2_INSIGHTS_WIDTH } from './v2Layout';

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

    // Salary mode
    salary_negotiate: <Handshake size={14} className="text-emerald-400" />,
    salary_counter: <DollarSign size={14} className="text-amber-400" />,
    salary_confidence: <Volume2 size={14} className="text-violet-400" />,
    salary_anchor: <Anchor size={14} className="text-cyan-400" />,
};

const getActionIcon = (action: OverlayQuickActionDef) => {
    return ACTION_ICONS[action.id] || <span style={{ fontSize: '12px' }}>{action.icon}</span>;
};

interface ProInsightsPanelProps {
    currentModel: string;
    isSettingsOpen: boolean;
    isMousePassthrough: boolean;
    overlayOpacity: number;
    customNotesEnabled: boolean;
    hasProContextAccess: boolean;
    onToggleMousePassthrough: () => void;
    onCycleOverlayOpacity: () => void;
    onToggleCustomContext: () => void;
    contextSummary: { label: string; detail: string };
    activeQuickActions: OverlayQuickActionDef[];
    recommendedButton: OverlayQuickActionId;
    overlayCopilotMode: string;
    lastFinalSentence: string;
    rollingTranscript: string;
    rollingTranscriptSpeakerLabel: string;
    isInterviewerSpeaking: boolean;
    showTranscript: boolean;
    contextPreviewByActionId: Partial<Record<OverlayQuickActionId, string>>;
    onToggleTranscript: () => void;
    getQuickActionHandler: (action: OverlayQuickActionDef) => () => void | Promise<void>;
    widthPx?: number;
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
    contextPreviewByActionId,
    onToggleTranscript,
    getQuickActionHandler,
    currentModel,
    isSettingsOpen,
    isMousePassthrough,
    overlayOpacity,
    customNotesEnabled,
    hasProContextAccess,
    onToggleMousePassthrough,
    onCycleOverlayOpacity,
    onToggleCustomContext,
    widthPx = V2_INSIGHTS_WIDTH,
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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1], delay: 0.04 }}
            className="v2-surface-insights v2-no-drag"
            style={{
                width: `${widthPx}px`,
                maxWidth: '100%',
                flex: `0 0 ${widthPx}px`,
                alignSelf: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                willChange: 'transform, opacity',
            }}
        >
            <ProOverlayControlStrip
                panelRef={panelRef}
                currentModel={currentModel}
                isSettingsOpen={isSettingsOpen}
                isMousePassthrough={isMousePassthrough}
                overlayOpacity={overlayOpacity}
                customNotesEnabled={customNotesEnabled}
                hasProContextAccess={hasProContextAccess}
                onToggleMousePassthrough={onToggleMousePassthrough}
                onCycleOverlayOpacity={onCycleOverlayOpacity}
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
            <div style={{ padding: '0 16px 12px' }}>
                <div className="v2-context-summary">
                    <div className="v2-context-label">{contextSummary.label}</div>
                    <div className="v2-context-detail">{contextSummary.detail}</div>
                </div>
            </div>

            {/* ── Actions (fixed, always visible) ── */}
            <div style={{ padding: '0 10px 10px', flexShrink: 0 }}>
                <div className="v2-section-header">Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {activeQuickActions.map((action, idx) => (
                        <motion.button
                            key={`${overlayCopilotMode}-${action.id}`}
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            whileHover={{ x: 1 }}
                            transition={{
                                duration: 0.22,
                                delay: idx * 0.035,
                                ease: [0.22, 1, 0.36, 1],
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
                            <span className="v2-action-copy">
                                <span className="v2-action-label">{action.label}</span>
                                <span className="v2-action-context-preview">
                                    Using: {contextPreviewByActionId[action.id] ?? 'Latest Question'}
                                </span>
                            </span>
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

        </motion.div>
    );
});

export default ProInsightsPanel;
