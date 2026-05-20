import React, { useState } from 'react';
import { ArrowLeft, Search, Mail, Link, ChevronDown, Play, ArrowUp, Copy, Check, MoreHorizontal, Settings, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MeetingChatOverlay from './MeetingChatOverlay';
import EditableTextBlock from './EditableTextBlock';
import TeamSyncLogo from './icon.png';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getTranscriptDisplayLabel, isHiddenTranscriptSpeaker } from '../utils/transcriptSpeakers';

const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
};

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

const cleanMarkdown = (content: string) => {
    if (!content) return '';
    // Ensure code blocks are on new lines to fix rendering issues
    return content.replace(/([^\n])```/g, '$1\n\n```');
};

const SUMMARY_PLACEHOLDER_VALUES = new Set([
    '',
    'See detailed summary',
    'Generating summary...',
]);

const getMeetingOverview = (meeting: Meeting) => {
    const detailedSummary = meeting.detailedSummary as (Meeting['detailedSummary'] & { summary?: string }) | undefined;
    const overview = detailedSummary?.overview?.trim();
    if (overview) return overview;

    const legacyDetailedSummary = detailedSummary?.summary?.trim();
    if (legacyDetailedSummary) return legacyDetailedSummary;

    const summary = meeting.summary?.trim();
    if (summary && !SUMMARY_PLACEHOLDER_VALUES.has(summary)) return summary;

    if (detailedSummary?.keyPoints?.length) {
        const keyPointSummary = detailedSummary.keyPoints.filter(Boolean).slice(0, 2).join(' ');
        if (keyPointSummary.trim()) return keyPointSummary.trim();
    }

    if (detailedSummary?.sections?.length) {
        const sectionSummary = detailedSummary.sections
            .flatMap(section => section.bullets || [])
            .filter(Boolean)
            .slice(0, 2)
            .join(' ');
        if (sectionSummary.trim()) return sectionSummary.trim();
    }

    if (detailedSummary?.actionItems?.length) {
        const actionSummary = detailedSummary.actionItems.filter(Boolean).slice(0, 1).join(' ');
        if (actionSummary.trim()) return actionSummary.trim();
    }

    return '';
};

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
    };
    transcript?: Array<{
        speaker: string;
        speakerId?: string;
        speakerLabel?: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

interface MeetingDetailsProps {
    meeting: Meeting;
    onBack: () => void;
    onOpenSettings: () => void;
}

const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting: initialMeeting }) => {
    // We need local state for the meeting object to reflect optimistic updates
    const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
    const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'usage'>('summary');
    const [query, setQuery] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [submittedQuery, setSubmittedQuery] = useState('');
    const overviewText = getMeetingOverview(meeting);
    const tabOptions: Array<'summary' | 'transcript' | 'usage'> = ['summary', 'transcript', 'usage'];
    const meetingDateLabel = new Date(meeting.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const copyLabel = isCopied
        ? 'Copied'
        : activeTab === 'summary'
            ? 'Copy full summary'
            : activeTab === 'transcript'
                ? 'Copy full transcript'
                : 'Copy usage';

    const handleSubmitQuestion = () => {
        if (query.trim()) {
            setSubmittedQuery(query);
            if (!isChatOpen) {
                setIsChatOpen(true);
            }
            setQuery('');
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            handleSubmitQuestion();
        }
    };

    const handleCopy = async () => {
        let textToCopy = '';

        if (activeTab === 'summary') {
            textToCopy = `
Meeting: ${meeting.title}
Date: ${new Date(meeting.date).toLocaleDateString()}

OVERVIEW:
${overviewText}

ACTION ITEMS:
${meeting.detailedSummary?.actionItems?.map(item => `- ${item}`).join('\n') || 'None'}

KEY POINTS:
${meeting.detailedSummary?.keyPoints?.map(item => `- ${item}`).join('\n') || 'None'}
            `.trim();
        } else if (activeTab === 'transcript' && meeting.transcript) {
            textToCopy = meeting.transcript.map(t => `[${formatTime(t.timestamp)}] ${getTranscriptDisplayLabel(t)}: ${t.text}`).join('\n');
        } else if (activeTab === 'usage' && meeting.usage) {
            textToCopy = meeting.usage.map(u => `Q: ${u.question || ''}\nA: ${u.answer || ''}`).join('\n\n');
        }

        if (!textToCopy) return;

        try {
            await navigator.clipboard.writeText(textToCopy);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy content:', err);
        }
    };

    // UPDATE HANDLERS
    const handleTitleSave = async (newTitle: string) => {
        setMeeting(prev => ({ ...prev, title: newTitle }));
        if (window.electronAPI?.updateMeetingTitle) {
            await window.electronAPI.updateMeetingTitle(meeting.id, newTitle);
        }
    };

    const handleOverviewSave = async (newOverview: string) => {
        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                overview: newOverview
            }
        }));
        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { overview: newOverview });
        }
    };

    const handleActionItemSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.actionItems || [])];
        if (!newVal.trim()) {
            // Optional: Remove empty items? For now just keep empty or update
        }
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                actionItems: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { actionItems: newItems });
        }
    };

    const handleKeyPointSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                keyPoints: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { keyPoints: newItems });
        }
    };


    return (
        <div className="meeting-notes-screen relative h-full w-full overflow-hidden font-sans text-text-secondary">
            <div className="meeting-notes-screen__ambient meeting-notes-screen__ambient--top" />
            <div className="meeting-notes-screen__ambient meeting-notes-screen__ambient--bottom" />

            <main className="relative z-10 flex-1 overflow-y-auto custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="mx-auto max-w-5xl px-5 py-6 pb-36 sm:px-8 sm:py-8"
                >
                    <section className="meeting-glass-shell">
                        <div className="meeting-glass-shell__glow" aria-hidden="true" />
                        <div className="relative z-10 p-6 sm:p-8 md:p-10">
                            <div className="mb-8 flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="mb-2 text-[15px] font-medium tracking-[-0.01em] text-text-tertiary">
                                        {meetingDateLabel}
                                    </p>
                                    <EditableTextBlock
                                        initialValue={meeting.title}
                                        onSave={handleTitleSave}
                                        tagName="h1"
                                        className="max-w-[18ch] -ml-2 rounded-2xl px-2 py-1 text-[2.25rem] font-semibold leading-[1.02] tracking-[-0.04em] text-text-primary transition-colors sm:text-[2.65rem]"
                                        multiline={false}
                                    />
                                </div>
                            </div>

                            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="meeting-glass-tabs">
                                    {tabOptions.map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveTab(tab)}
                                            className={`meeting-glass-tab ${activeTab === tab ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                                        >
                                            {activeTab === tab && (
                                                <motion.div
                                                    layoutId="activeTabBackground"
                                                    className="meeting-glass-tab__active-surface"
                                                    initial={false}
                                                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                                />
                                            )}
                                            <span className="relative z-10 capitalize">{tab}</span>
                                        </button>
                                    ))}
                                </div>

                                <button
                                    onClick={handleCopy}
                                    className="meeting-glass-copy-button"
                                >
                                    {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                    {copyLabel}
                                </button>
                            </div>

                            <div className="space-y-5">
                                {activeTab === 'summary' && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
                                        {overviewText && (
                                            <section className="meeting-glass-overview prose prose-sm max-w-none">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{
                                                        h1: ({ node, ...props }) => <h1 className="mt-4 mb-2 text-xl font-bold text-text-primary" {...props} />,
                                                        h2: ({ node, ...props }) => <h2 className="mt-4 mb-2 text-lg font-semibold text-text-primary" {...props} />,
                                                        h3: ({ node, ...props }) => <h3 className="mt-3 mb-1 text-base font-semibold text-text-primary" {...props} />,
                                                        p: ({ node, ...props }) => <p className="mb-2 text-[15px] leading-[1.85] text-text-secondary" {...props} />,
                                                        ul: ({ node, ...props }) => <ul className="mb-2 ml-4 list-disc space-y-1" {...props} />,
                                                        ol: ({ node, ...props }) => <ol className="mb-2 ml-4 list-decimal space-y-1" {...props} />,
                                                        li: ({ node, ...props }) => <li className="text-[15px] text-text-secondary" {...props} />,
                                                        strong: ({ node, ...props }) => <strong className="font-semibold text-text-primary" {...props} />,
                                                        a: ({ node, ...props }) => <a className="text-blue-500 hover:underline" {...props} />,
                                                    }}
                                                >
                                                    {cleanMarkdown(overviewText)}
                                                </ReactMarkdown>
                                            </section>
                                        )}

                                        {meeting.detailedSummary?.actionItems && meeting.detailedSummary.actionItems.length > 0 && (
                                            <section className="meeting-glass-section">
                                                <div className="mb-4 flex items-center justify-between">
                                                    <EditableTextBlock
                                                        initialValue={meeting.detailedSummary?.actionItemsTitle || 'Action Items'}
                                                        onSave={(val) => {
                                                            setMeeting(prev => ({
                                                                ...prev,
                                                                detailedSummary: { ...prev.detailedSummary!, actionItemsTitle: val }
                                                            }));
                                                            window.electronAPI?.updateMeetingSummary(meeting.id, { actionItemsTitle: val });
                                                        }}
                                                        tagName="h2"
                                                        className="-ml-2 rounded-xl px-2 py-1 text-[1.35rem] font-semibold tracking-[-0.03em] text-text-primary transition-colors"
                                                        multiline={false}
                                                    />
                                                </div>
                                                <ul className="space-y-3">
                                                    {meeting.detailedSummary.actionItems.map((item, i) => (
                                                        <li key={i} className="meeting-glass-list-row">
                                                            <div className="meeting-glass-check">
                                                                <Check size={13} strokeWidth={2.2} />
                                                            </div>
                                                            <div className="flex-1">
                                                                <EditableTextBlock
                                                                    initialValue={item}
                                                                    onSave={(val) => handleActionItemSave(i, val)}
                                                                    tagName="p"
                                                                    className="-ml-2 rounded-xl px-2 py-1 text-[15px] leading-relaxed text-text-secondary transition-colors"
                                                                    placeholder="Type an action item..."
                                                                    onEnter={() => {
                                                                        const newItems = [...(meeting.detailedSummary?.actionItems || [])];
                                                                        newItems.splice(i + 1, 0, '');
                                                                        setMeeting(prev => ({
                                                                            ...prev,
                                                                            detailedSummary: { ...prev.detailedSummary!, actionItems: newItems }
                                                                        }));
                                                                    }}
                                                                />
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </section>
                                        )}

                                        {meeting.detailedSummary?.keyPoints && meeting.detailedSummary.keyPoints.length > 0 && (
                                            <section className="meeting-glass-section">
                                                <div className="mb-4 flex items-center justify-between">
                                                    <EditableTextBlock
                                                        initialValue={meeting.detailedSummary?.keyPointsTitle || 'Key Points'}
                                                        onSave={(val) => {
                                                            setMeeting(prev => ({
                                                                ...prev,
                                                                detailedSummary: { ...prev.detailedSummary!, keyPointsTitle: val }
                                                            }));
                                                            window.electronAPI?.updateMeetingSummary(meeting.id, { keyPointsTitle: val });
                                                        }}
                                                        tagName="h2"
                                                        className="-ml-2 rounded-xl px-2 py-1 text-[1.35rem] font-semibold tracking-[-0.03em] text-text-primary transition-colors"
                                                        multiline={false}
                                                    />
                                                </div>
                                                <ul className="space-y-3">
                                                    {meeting.detailedSummary.keyPoints.map((item, i) => (
                                                        <li key={i} className="meeting-glass-list-row">
                                                            <div className="meeting-glass-dot mt-3" />
                                                            <div className="flex-1">
                                                                <EditableTextBlock
                                                                    initialValue={item}
                                                                    onSave={(val) => handleKeyPointSave(i, val)}
                                                                    tagName="p"
                                                                    className="-ml-2 rounded-xl px-2 py-1 text-[15px] leading-relaxed text-text-secondary transition-colors"
                                                                    placeholder="Type a key point..."
                                                                    onEnter={() => {
                                                                        const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
                                                                        newItems.splice(i + 1, 0, '');
                                                                        setMeeting(prev => ({
                                                                            ...prev,
                                                                            detailedSummary: { ...prev.detailedSummary!, keyPoints: newItems }
                                                                        }));
                                                                    }}
                                                                />
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </section>
                                        )}

                                        {meeting.detailedSummary?.sections && meeting.detailedSummary.sections.length > 0 && (
                                            <div className="space-y-5">
                                                {meeting.detailedSummary.sections.map((section, si) => (
                                                    section.bullets.length > 0 && (
                                                        <section key={si} className="meeting-glass-section">
                                                            <div className="mb-4 flex items-center justify-between">
                                                                <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-text-primary">{section.title}</h2>
                                                            </div>
                                                            <ul className="space-y-3">
                                                                {section.bullets.map((bullet, bi) => (
                                                                    <li key={bi} className="meeting-glass-list-row">
                                                                        <div className="meeting-glass-dot mt-3" />
                                                                        <p className="flex-1 text-[15px] leading-relaxed text-text-secondary">{bullet}</p>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </section>
                                                    )
                                                ))}
                                            </div>
                                        )}
                                    </motion.div>
                                )}

                                {activeTab === 'transcript' && (
                                    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        <div className="meeting-glass-section space-y-5">
                                            {(() => {
                                                console.log('Raw Transcript:', meeting.transcript);
                                                const filteredTranscript = meeting.transcript?.filter(entry => {
                                                    const isHidden = isHiddenTranscriptSpeaker(entry.speaker);
                                                    if (isHidden) console.log('Filtered out:', entry);
                                                    return !isHidden;
                                                }) || [];
                                                console.log('Filtered Transcript:', filteredTranscript);

                                                if (filteredTranscript.length === 0) {
                                                    return <p className="text-[15px] text-text-tertiary">No transcript available.</p>;
                                                }

                                                return filteredTranscript.map((entry, i) => (
                                                    <div key={i} className="meeting-glass-transcript-row">
                                                        <div className="mb-2 flex items-center gap-2">
                                                            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                                                                {getTranscriptDisplayLabel(entry)}
                                                            </span>
                                                            <span className="text-[12px] font-medium text-text-tertiary">{entry.timestamp ? formatTime(entry.timestamp) : '0:00'}</span>
                                                        </div>
                                                        <p className="cursor-text select-text text-[15px] leading-[1.85] text-text-secondary transition-colors">{entry.text}</p>
                                                    </div>
                                                ));
                                            })()}
                                        </div>
                                    </motion.section>
                                )}

                                {activeTab === 'usage' && (
                                    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 pb-6">
                                        {meeting.usage?.map((interaction, i) => (
                                            <div key={i} className="meeting-glass-section space-y-4">
                                                {interaction.question && (
                                                    <div className="flex justify-end">
                                                        <div className="meeting-glass-question-bubble">
                                                            {interaction.question}
                                                        </div>
                                                    </div>
                                                )}

                                                {interaction.answer && (
                                                    <div className="flex items-start gap-4">
                                                        <div className="meeting-glass-avatar">
                                                            <img src={TeamSyncLogo} alt="AI" className="force-black-icon h-4 w-4 object-contain opacity-60" />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-text-tertiary">{formatTime(interaction.timestamp)}</div>
                                                            <div className="text-[15px] leading-relaxed text-text-secondary max-w-none">
                                                                <ReactMarkdown
                                                                    remarkPlugins={[remarkGfm]}
                                                                    components={{
                                                                        h1: ({ node, ...props }) => <p className="mb-2 whitespace-pre-wrap text-[15px] font-normal leading-relaxed text-text-secondary" {...props} />,
                                                                        h2: ({ node, ...props }) => <p className="mb-2 whitespace-pre-wrap text-[15px] font-normal leading-relaxed text-text-secondary" {...props} />,
                                                                        h3: ({ node, ...props }) => <p className="mb-2 whitespace-pre-wrap text-[15px] font-normal leading-relaxed text-text-secondary" {...props} />,
                                                                        p: ({ node, ...props }) => <p className="mb-2 whitespace-pre-wrap text-[15px] font-normal leading-relaxed text-text-secondary" {...props} />,
                                                                        ul: ({ node, ...props }) => <ul className="mb-2 ml-4 list-disc space-y-1" {...props} />,
                                                                        ol: ({ node, ...props }) => <ol className="mb-2 ml-4 list-decimal space-y-1" {...props} />,
                                                                        li: ({ node, ...props }) => <li className="text-[15px] font-normal text-text-secondary" {...props} />,
                                                                        strong: ({ node, ...props }) => <span className="font-normal text-text-secondary" {...props} />,
                                                                        a: ({ node, ...props }: any) => <a className="text-blue-500 hover:underline" {...props} />,
                                                                        pre: ({ children }: any) => <div className="not-prose mb-4">{children}</div>,
                                                                        code: ({ node, inline, className, children, ...props }: any) => {
                                                                            const match = /language-(\w+)/.exec(className || '');
                                                                            const isInline = inline ?? false;
                                                                            const lang = match ? match[1] : '';

                                                                            return !isInline ? (
                                                                                <div className="my-3 overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-800/60 shadow-lg backdrop-blur-md">
                                                                                    <div className="border-b border-white/[0.08] bg-white/[0.04] px-3 py-1.5">
                                                                                        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-white/40">
                                                                                            {lang || 'CODE'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="bg-transparent">
                                                                                        <SyntaxHighlighter
                                                                                            language={lang || 'text'}
                                                                                            style={vscDarkPlus}
                                                                                            customStyle={{
                                                                                                margin: 0,
                                                                                                borderRadius: 0,
                                                                                                fontSize: '13px',
                                                                                                lineHeight: '1.6',
                                                                                                background: 'transparent',
                                                                                                padding: '16px',
                                                                                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                                                            }}
                                                                                            wrapLongLines={true}
                                                                                            showLineNumbers={true}
                                                                                            lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '11px' }}
                                                                                            {...props}
                                                                                        >
                                                                                            {String(children).replace(/\n$/, '')}
                                                                                        </SyntaxHighlighter>
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <code className="rounded border border-border-subtle bg-bg-input px-1.5 py-0.5 font-mono text-[13px] text-text-primary whitespace-pre-wrap" {...props}>
                                                                                    {children}
                                                                                </code>
                                                                            );
                                                                        }
                                                                    }}
                                                                >
                                                                    {cleanMarkdown(interaction.answer || '')}
                                                                </ReactMarkdown>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        {!meeting.usage?.length && (
                                            <div className="meeting-glass-section">
                                                <p className="text-[15px] text-text-tertiary">No usage history.</p>
                                            </div>
                                        )}
                                    </motion.section>
                                )}
                            </div>
                        </div>
                    </section>
                </motion.div>
            </main>

            <div className={`absolute bottom-0 left-0 right-0 flex justify-center p-6 pointer-events-none ${isChatOpen ? 'z-50' : 'z-20'}`}>
                <div className="pointer-events-auto relative w-full max-w-[570px]">
                    <div className="meeting-glass-askbar">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            placeholder="Ask about this meeting..."
                            className="meeting-glass-askbar__input"
                        />
                        <button
                            onClick={handleSubmitQuestion}
                            className={`meeting-glass-askbar__button ${query.trim() ? 'meeting-glass-askbar__button--ready' : ''}`}
                        >
                            <ArrowUp size={16} className="rotate-45 transform" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Chat Overlay */}
            <MeetingChatOverlay
                isOpen={isChatOpen}
                onClose={() => {
                    setIsChatOpen(false);
                    setQuery('');
                    setSubmittedQuery('');
                }}
                meetingContext={{
                    id: meeting.id,  // Required for RAG queries
                    title: meeting.title,
                    summary: meeting.detailedSummary?.overview,
                    keyPoints: meeting.detailedSummary?.keyPoints,
                    actionItems: meeting.detailedSummary?.actionItems,
                    transcript: meeting.transcript
                }}
                initialQuery={submittedQuery}
                onNewQuery={(newQuery) => {
                    setSubmittedQuery(newQuery);
                }}
            />
        </div>
    );
};

export default MeetingDetails;
