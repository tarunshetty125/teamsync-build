/**
 * ProResponseSurface.tsx — Surface 3
 * 
 * AI reading surface (right, adaptive width 480–720px).
 * Dynamic height: fit-content, max 75vh, grows with content.
 * Uses existing PremiumResponseCard for rendering.
 * Label: "TeamSync Intelligence"
 */

import React, { memo, useCallback, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SkeletonLoader, EmptyListeningState } from '../ui/PremiumStates';
import CodeBlock from '../ui/CodeBlock';
import MermaidRenderer from '../ui/MermaidRenderer';
import type { V2Message } from './useCluelyOverlayBridge';
import { resolveV2ResponseWidthPx, V2_RESPONSE_MIN_WIDTH, V2_RESPONSE_MAX_WIDTH } from './v2Layout';

interface ProResponseSurfaceProps {
    latestResponse: V2Message | null;
    isProcessing: boolean;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
}

// Source icon mapping
const SOURCE_ICONS: Record<string, string> = {
    'What to Answer': '💡',
    'Clarify': '🔍',
    'Follow Up': '➡️',
    'Follow Up Questions': '❓',
    'Recap': '📋',
    'Code Hint': '💻',
    'Brainstorm': '✨',
    'Screen Scan': '📸',
    'System Design Trade-offs': '⚖️',
    'Answer Now': '🎤',
    'Manual Input': '✏️',
};

const ProResponseSurface = memo<ProResponseSurfaceProps>(function ProResponseSurface({
    latestResponse,
    isProcessing,
    scrollContainerRef,
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        if (!latestResponse?.text) return;
        navigator.clipboard.writeText(latestResponse.text).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [latestResponse?.text]);

    const hasContent = !!latestResponse?.text || isProcessing;
    const source = latestResponse?.source;
    const sourceIcon = source ? (SOURCE_ICONS[source] || '✦') : null;
    const isStreaming = latestResponse?.isStreaming;

    // Chips
    const chips = latestResponse?.chips;

    const responseWidthPx = useMemo(
        () => resolveV2ResponseWidthPx(latestResponse?.text),
        [latestResponse?.text],
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
            className="v2-surface-response v2-no-drag"
            style={{
                minWidth: `${V2_RESPONSE_MIN_WIDTH}px`,
                maxWidth: `${V2_RESPONSE_MAX_WIDTH}px`,
                width: `${responseWidthPx}px`,
                flex: '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
                willChange: 'transform, opacity',
                transition: 'width 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
        >
            {/* ── Header ── */}
            <div className="v2-panel-header">
                <div className="v2-panel-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                    TeamSync Intelligence
                </div>
                <div className="v2-panel-actions">
                    {/* Source pill */}
                    {source && (
                        <div className="v2-source-pill">
                            {sourceIcon && <span style={{ fontSize: '11px' }}>{sourceIcon}</span>}
                            <span>{source}</span>
                            {isStreaming && (
                                <span style={{
                                    width: '4px',
                                    height: '4px',
                                    borderRadius: '50%',
                                    background: 'rgba(139, 92, 246, 0.8)',
                                    animation: 'v2-dot-pulse 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
                                }} />
                            )}
                        </div>
                    )}
                    {/* Copy */}
                    {latestResponse?.text && (
                        <button className="v2-panel-btn" onClick={handleCopy} title="Copy response">
                            {copied ? (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(52,211,153,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            ) : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* ── Response Body — dynamic height ── */}
            <div
                ref={scrollContainerRef as React.RefObject<HTMLDivElement>}
                className="v2-scroll-area"
                style={{
                    maxHeight: '65vh',
                    padding: '4px 20px 20px',
                    overflowY: 'auto',
                    overflowX: 'auto',
                }}
            >
                <AnimatePresence mode="wait">
                    {isProcessing && !latestResponse?.text ? (
                        <motion.div
                            key="skeleton"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <SkeletonLoader isLightTheme={false} />
                        </motion.div>
                    ) : latestResponse?.text ? (
                        <motion.div
                            key={`response-${latestResponse.id}`}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                            className="v2-response-body"
                        >
                            {/* Negotiation coaching card */}
                            {latestResponse.isNegotiationCoaching && latestResponse.negotiationCoachingData ? (
                                <div style={{
                                    padding: '16px',
                                    borderRadius: '14px',
                                    background: 'rgba(139, 92, 246, 0.06)',
                                    border: '1px solid rgba(139, 92, 246, 0.12)',
                                }}>
                                    <div style={{
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        letterSpacing: '0.08em',
                                        textTransform: 'uppercase',
                                        color: 'rgba(196, 181, 253, 0.7)',
                                        marginBottom: '8px',
                                    }}>
                                        {latestResponse.negotiationCoachingData.phase || 'Negotiation'}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
                                        {latestResponse.negotiationCoachingData.tacticalNote}
                                    </div>
                                    {latestResponse.negotiationCoachingData.exactScript && (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '12px',
                                            borderRadius: '10px',
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            fontSize: '13px',
                                            fontStyle: 'italic',
                                            color: 'rgba(255,255,255,0.78)',
                                            lineHeight: 1.6,
                                        }}>
                                            "{latestResponse.negotiationCoachingData.exactScript}"
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <V2ResponseText
                                    text={latestResponse.text}
                                    isStreaming={!!isStreaming}
                                    isCode={!!latestResponse.isCode}
                                />
                            )}

                            {/* Streaming cursor */}
                            {isStreaming && (
                                <span style={{
                                    display: 'inline-block',
                                    width: '6px',
                                    height: '14px',
                                    background: 'rgba(139, 92, 246, 0.6)',
                                    borderRadius: '1px',
                                    marginLeft: '2px',
                                    animation: 'v2-dot-pulse 1s ease-in-out infinite',
                                    verticalAlign: 'text-bottom',
                                }} />
                            )}

                            {/* Response chips */}
                            {chips && chips.length > 0 && !isStreaming && (
                                <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px',
                                    marginTop: '14px',
                                    paddingTop: '12px',
                                    borderTop: '1px solid rgba(255,255,255,0.05)',
                                }}>
                                    {chips.map((chip, i) => (
                                        <span
                                            key={i}
                                            className="v2-chip"
                                            style={{
                                                background: getChipBg(chip.variant),
                                                color: getChipColor(chip.variant),
                                                border: `1px solid ${getChipBorder(chip.variant)}`,
                                            }}
                                        >
                                            {chip.label}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <EmptyListeningState isLightTheme={false} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
});

const V2_MARKDOWN_COMPONENTS: Components = {
    p: ({ children }) => <p style={{ marginBottom: '10px' }}>{children}</p>,
    strong: ({ children }) => <strong style={{ fontWeight: 600, color: 'rgba(255,255,255,0.95)' }}>{children}</strong>,
    ul: ({ children }) => <ul style={{ marginLeft: '16px', marginBottom: '8px', listStyleType: 'disc' }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ marginLeft: '16px', marginBottom: '8px', listStyleType: 'decimal' }}>{children}</ol>,
    li: ({ children }) => <li style={{ marginBottom: '3px', paddingLeft: '2px' }}>{children}</li>,
    h3: ({ children }) => (
        <h3 style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.30)',
            marginTop: '16px',
            marginBottom: '6px',
            paddingBottom: '6px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
            {children}
        </h3>
    ),
    code: ({ children, className }) => {
        const isFenced = typeof className === 'string' && className.startsWith('language-');
        if (isFenced) {
            return <code className={className}>{children}</code>;
        }
        return (
            <code style={{
                fontSize: '12px',
                fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
                background: 'rgba(255,255,255,0.06)',
                padding: '1px 5px',
                borderRadius: '4px',
                color: 'rgba(255,255,255,0.82)',
            }}>
                {children}
            </code>
        );
    },
    pre: ({ children }) => <pre className="v2-response-pre">{children}</pre>,
    a: ({ href, children }) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'underline', opacity: 0.8 }}
        >
            {children}
        </a>
    ),
};

function parseFencePart(part: string): { lang: string; code: string } | null {
    if (!part.startsWith('```')) return null;
    const match = part.match(/```[ \t]*([A-Za-z0-9_-]*)\s*([\s\S]*?)(?:```|$)/);
    if (match) {
        return { lang: match[1] || 'text', code: match[2].trim() };
    }
    const code = part.replace(/^```[ \t]*[A-Za-z0-9_-]*\s*/, '').replace(/```$/, '').trim();
    return code ? { lang: 'text', code } : null;
}

const V2ResponseText = memo<{
    text: string;
    isStreaming?: boolean;
    isCode?: boolean;
}>(function V2ResponseText({ text, isStreaming, isCode }) {
    if (isStreaming) {
        return (
            <div
                className="v2-response-streaming"
                style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '14px',
                    lineHeight: 1.75,
                    color: 'rgba(255,255,255,0.88)',
                }}
            >
                {text}
            </div>
        );
    }

    if (!text.includes('```')) {
        return (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={V2_MARKDOWN_COMPONENTS}>
                {text}
            </ReactMarkdown>
        );
    }

    const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
    const body = (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('```')) {
                    const parsed = parseFencePart(part);
                    if (!parsed || !parsed.code) return null;
                    const lang = parsed.lang.toLowerCase();
                    if (lang === 'mermaid') {
                        return <MermaidRenderer key={i} chart={parsed.code} isLightTheme={false} />;
                    }
                    return (
                        <CodeBlock
                            key={i}
                            code={parsed.code}
                            language={parsed.lang || 'text'}
                            isLightTheme={false}
                        />
                    );
                }
                if (!part.trim()) return null;
                return (
                    <ReactMarkdown
                        key={i}
                        remarkPlugins={[remarkGfm]}
                        components={V2_MARKDOWN_COMPONENTS}
                    >
                        {part}
                    </ReactMarkdown>
                );
            })}
        </>
    );

    if (isCode) {
        return (
            <div className="v2-code-section">
                <div className="v2-code-section-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                    </svg>
                    Code Solution
                </div>
                <div className="v2-code-section-body">{body}</div>
            </div>
        );
    }

    return <>{body}</>;
});

// Chip color helpers
function getChipBg(variant: string): string {
    const map: Record<string, string> = {
        green: 'rgba(34,197,94,0.10)',
        amber: 'rgba(245,158,11,0.10)',
        red: 'rgba(239,68,68,0.10)',
        blue: 'rgba(59,130,246,0.10)',
        purple: 'rgba(167,139,250,0.10)',
        gray: 'rgba(255,255,255,0.05)',
    };
    return map[variant] || map.gray;
}

function getChipColor(variant: string): string {
    const map: Record<string, string> = {
        green: '#4ADE80',
        amber: '#FCD34D',
        red: '#FCA5A5',
        blue: '#93C5FD',
        purple: '#C4B5FD',
        gray: '#9CA3AF',
    };
    return map[variant] || map.gray;
}

function getChipBorder(variant: string): string {
    const map: Record<string, string> = {
        green: 'rgba(34,197,94,0.20)',
        amber: 'rgba(245,158,11,0.22)',
        red: 'rgba(239,68,68,0.20)',
        blue: 'rgba(59,130,246,0.20)',
        purple: 'rgba(167,139,250,0.20)',
        gray: 'rgba(255,255,255,0.08)',
    };
    return map[variant] || map.gray;
}

export default ProResponseSurface;
