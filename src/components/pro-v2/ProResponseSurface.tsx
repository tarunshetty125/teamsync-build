/**
 * ProResponseSurface.tsx — Surface 3
 * 
 * AI reading surface (right, adaptive width 480–720px).
 * Dynamic height: fit-content, max 75vh, grows with content.
 * Uses existing PremiumResponseCard for rendering.
 * Label: "TeamSync Intelligence"
 */

import React, { memo, useCallback, useEffect, useState, useMemo } from 'react';
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

    useEffect(() => {
        console.debug('[V2][ProResponseSurface] render gate', {
            latestResponseId: latestResponse?.id ?? null,
            requestId: latestResponse?.requestId ?? null,
            intent: latestResponse?.intent ?? null,
            source,
            isProcessing,
            isStreaming: latestResponse?.isStreaming ?? null,
            textLength: latestResponse?.text.length ?? 0,
            showingSkeleton: isProcessing && !latestResponse?.text,
            showingResponse: Boolean(latestResponse?.text),
            showingEmpty: !isProcessing && !latestResponse?.text,
        });
    }, [isProcessing, latestResponse, source]);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1], delay: 0.06, layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
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
                <div className="v2-panel-title v2-panel-title--primary">
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
                className="v2-scroll-area v2-response-scroll"
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
                            initial={{ opacity: 0, y: 6, scale: 0.995 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
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

const MERMAID_DIAGRAM_RE =
    /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/i;

function isMermaidLanguage(lang: string): boolean {
    const normalized = lang.trim().toLowerCase();
    return normalized === 'mermaid' || normalized.startsWith('mermaid');
}

function looksLikeMermaidSource(code: string): boolean {
    const trimmed = code.trim();
    if (!trimmed) return false;
    if (/^mermaid[\s\r\n]/i.test(trimmed)) return true;
    return MERMAID_DIAGRAM_RE.test(trimmed);
}

function normalizeMermaidChart(code: string): string {
    return code.replace(/^mermaid[\s\r\n]+/i, '').trim();
}

function resolveFenceContent(parsed: { lang: string; code: string }):
    | { kind: 'mermaid'; chart: string }
    | { kind: 'code'; lang: string; code: string } {
    const lang = parsed.lang.trim();
    if (isMermaidLanguage(lang)) {
        return { kind: 'mermaid', chart: parsed.code };
    }
    if (looksLikeMermaidSource(parsed.code)) {
        return { kind: 'mermaid', chart: normalizeMermaidChart(parsed.code) };
    }
    return { kind: 'code', lang: lang || 'text', code: parsed.code };
}

function isFenceClosed(part: string): boolean {
    const trimmed = part.trimEnd();
    // Models often emit `` (2 backticks) instead of ``` (3) as closing fence.
    // Match both. The part always starts with ```, so length > 3 avoids self-match.
    if (trimmed.length <= 3) return false;
    // Check for ``` closing
    if (trimmed.endsWith('```')) return true;
    // Check for `` on its own line as malformed closing
    if (/\n\s*``\s*$/.test(trimmed)) return true;
    return false;
}

function extractMermaidChartFromPre(children: React.ReactNode): string | null {
    if (!React.isValidElement(children)) return null;
    const child = children as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
    const className = child.props?.className || '';
    if (typeof className !== 'string' || !className.includes('language-mermaid')) return null;
    const chart = String(child.props.children ?? '').replace(/\n$/, '').trim();
    return chart || null;
}

const V2_MARKDOWN_COMPONENTS: Components = {
    p: ({ children }) => <p style={{ marginBottom: '10px' }}>{children}</p>,
    strong: ({ children }) => <strong style={{ fontWeight: 500, color: 'rgba(255,255,255,0.96)' }}>{children}</strong>,
    ul: ({ children }) => <ul style={{ marginLeft: '16px', marginBottom: '8px', listStyleType: 'disc' }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ marginLeft: '16px', marginBottom: '8px', listStyleType: 'decimal' }}>{children}</ol>,
    li: ({ children }) => <li style={{ marginBottom: '3px', paddingLeft: '2px' }}>{children}</li>,
    h3: ({ children }) => <h3>{children}</h3>,
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
    pre: ({ children }) => {
        const mermaidChart = extractMermaidChartFromPre(children);
        if (mermaidChart) {
            return <MermaidRenderer chart={mermaidChart} isLightTheme={false} />;
        }
        return <pre className="v2-response-pre">{children}</pre>;
    },
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
    // Match opening fence: ```lang id="xxx" or ```lang or just ```
    // Strip any trailing attributes (id="...", etc.) from the language line
    const headerMatch = part.match(/^```[ \t]*([A-Za-z0-9_-]*)(?:\s+[^\n]*)?\n?/);
    const lang = headerMatch?.[1] || 'text';
    // Remove the opening fence header
    let code = part.replace(/^```[ \t]*[^\n]*\n?/, '');
    // Remove closing fence: ``` (proper) or `` (malformed, models often emit 2 backticks)
    code = code.replace(/\n?\s*`{2,3}\s*$/, '');
    code = code.trim();
    return code ? { lang, code } : null;
}

function renderFenceBlock(part: string, key: number, allowOpenMermaid: boolean) {
    const parsed = parseFencePart(part);
    if (!parsed || !parsed.code) return null;

    const closed = isFenceClosed(part);
    const resolved = resolveFenceContent(parsed);

    function sanitizePossiblyUnclosedMermaidChart(chart: string): string {
        // If the model forgets the closing ``` then our split() will include the rest
        // of the markdown response inside the mermaid payload. Mermaid will then
        // fail to parse and we show a fallback box.
        // Heuristic: stop the mermaid content at the next markdown section header
        // or a new fenced block — but be careful not to truncate valid Mermaid
        // keywords (e.g. "end" in subgraphs/loops).
        const s = chart.trim();
        if (!s) return s;

        // Split on markdown headings (## 5. Title, ### Architecture, etc.)
        // \S matches any non-whitespace start char (digits, letters, etc.)
        const beforeNextHeading = s.split(/\n\s*#{1,6}\s+\S/)[0].trim();
        // Split on a new triple-backtick fence opening (not Mermaid syntax)
        const beforeNextFence = beforeNextHeading.split(/\n\s*```[a-zA-Z]/)[0].trim();
        const cleaned = (beforeNextFence || beforeNextHeading || s)
            // If the model leaked a partial fence (e.g. "``") at the end, remove it.
            .replace(/`{1,3}\s*$/g, '')
            .trim();
        return cleaned;
    }

    if (resolved.kind === 'mermaid') {
        const chartForRender =
            closed
                ? resolved.chart
                : sanitizePossiblyUnclosedMermaidChart(resolved.chart);

        if (!closed && !allowOpenMermaid) {
            return (
                <pre key={key} className="v2-response-pre v2-response-pre--streaming">
                    {chartForRender}
                </pre>
            );
        }

        return (
            <MermaidRenderer
                key={`${key}-${chartForRender.length}`}
                chart={chartForRender}
                isLightTheme={false}
            />
        );
    }

    if (!closed) {
        return (
            <pre key={key} className="v2-response-pre v2-response-pre--streaming">
                {resolved.code}
            </pre>
        );
    }

    return (
        <CodeBlock
            key={key}
            code={resolved.code}
            language={resolved.lang}
            isLightTheme={false}
        />
    );
}

function renderV2ResponseBody(text: string, allowOpenMermaid: boolean) {
    if (!text.includes('```')) {
        if (allowOpenMermaid) {
            const mermaidStartRe = /(^|\n)\s*(mermaid\b|graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;
            const match = mermaidStartRe.exec(text);
            if (match) {
                const startIndex = match.index + (match[1] ? match[1].length : 0);
                const before = text.slice(0, startIndex).trim();
                const chartSource = text.slice(startIndex).trim();
                return (
                    <>
                        {before && (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={V2_MARKDOWN_COMPONENTS}>
                                {before}
                            </ReactMarkdown>
                        )}
                        <MermaidRenderer chart={chartSource} isLightTheme={false} />
                    </>
                );
            }
        }

        return (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={V2_MARKDOWN_COMPONENTS}>
                {text}
            </ReactMarkdown>
        );
    }

    // Split on fenced code blocks. Match closing as ``` (proper) or `` on its own line (malformed).
    // Models frequently emit `` instead of ``` as closing fence.
    const parts = text.split(/(```[\s\S]*?(?:```|\n``\s*(?:\n|$)|$))/g);
    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('```')) {
                    return renderFenceBlock(part, i, allowOpenMermaid);
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
}

function responseContainsMermaid(text: string): boolean {
    return /```[ \t]*mermaid/i.test(text) || looksLikeMermaidSource(text);
}

const V2ResponseText = memo<{
    text: string;
    isStreaming?: boolean;
    isCode?: boolean;
}>(function V2ResponseText({ text, isStreaming, isCode }) {
    // During streaming: render Mermaid blocks that have complete fences.
    // Incomplete / open fences show as raw pre blocks (handled by renderFenceBlock).
    // This ensures completed Mermaid diagrams appear even mid-stream,
    // and the final completed response always triggers a proper render.
    const allowOpenMermaid = !isStreaming;
    const body = renderV2ResponseBody(text, allowOpenMermaid);
    const wrapAsCodeSection = Boolean(isCode) && !responseContainsMermaid(text);

    if (wrapAsCodeSection) {
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
