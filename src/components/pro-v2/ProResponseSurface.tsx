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
import { ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { SkeletonLoader, EmptyListeningState } from '../ui/PremiumStates';
import CodeBlock from '../ui/CodeBlock';
import MermaidRenderer from '../ui/MermaidRenderer';
import type { V2Message } from './useCluelyOverlayBridge';
import type { ResponseSelectionMode } from '../../lib/overlay/responseHistorySelection';
import { getProviderModelMetadata } from '../../lib/providers/providerModelMetadata';
import { resolveV2ResponseWidthPx, V2_RESPONSE_MIN_WIDTH, V2_RESPONSE_MAX_WIDTH } from './v2Layout';
import ArchitectureRenderer from './architecture/ArchitectureRenderer';
import {
    looksLikeSystemDesignResponse,
    parseArchitectureResponse,
} from './architecture/architectureParser';
import {
    looksLikeMermaidSource,
    normalizeMermaidChartSource,
    normalizeV2MermaidMarkdown,
} from '../../lib/overlay/v2Mermaid';

interface ProResponseSurfaceProps {
    activeResponse: V2Message | null;
    isProcessing: boolean;
    activeResponseIndex: number;
    responseHistoryTotal: number;
    selectionMode: ResponseSelectionMode;
    canGoPreviousResponse: boolean;
    canGoNextResponse: boolean;
    canJumpLatestResponse: boolean;
    onPreviousResponse: () => void;
    onNextResponse: () => void;
    onJumpLatestResponse: () => void;
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
    activeResponse,
    isProcessing,
    activeResponseIndex,
    responseHistoryTotal,
    selectionMode,
    canGoPreviousResponse,
    canGoNextResponse,
    canJumpLatestResponse,
    onPreviousResponse,
    onNextResponse,
    onJumpLatestResponse,
    scrollContainerRef,
}) {
    const [copied, setCopied] = useState(false);
    const renderedResponse = activeResponse;

    const handleCopy = useCallback(() => {
        if (!renderedResponse?.text) return;
        navigator.clipboard.writeText(renderedResponse.text).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [renderedResponse?.text]);

    const hasContent = !!renderedResponse?.text || isProcessing;
    const source = renderedResponse?.source;
    const sourceIcon = source ? (SOURCE_ICONS[source] || '✦') : null;
    const isStreaming = renderedResponse?.isStreaming;

    // Chips
    const chips = renderedResponse?.chips;
    const hasHistory = responseHistoryTotal > 1;
    const isPinnedSelection = selectionMode === 'pinned';
    const responseMetaItems = useMemo(
        () => buildResponseMetaItems(renderedResponse),
        [renderedResponse],
    );

    const responseWidthPx = useMemo(
        () => resolveV2ResponseWidthPx(renderedResponse?.text),
        [renderedResponse?.text],
    );

    const isSystemDesignResponse = useMemo(() => {
        const text = renderedResponse?.text ?? '';
        if (!text.trim()) return false;

        return looksLikeSystemDesignResponse(text)
            || /```[ \t]*(?:architecture_json|mermaid)\b/i.test(text)
            || /\b(?:architecture diagram|system design)\b/i.test(text);
    }, [renderedResponse?.text]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
            className="v2-surface-response v2-draggable"
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
                <div className="v2-panel-actions v2-no-drag">
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
                    {renderedResponse?.text && (
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

            {responseMetaItems.length > 0 && (
                <div className="v2-response-meta-strip v2-no-drag" aria-label="Response metadata">
                    {responseMetaItems.map((item) => (
                        <div className="v2-response-meta-item" key={item.label} title={item.title ?? item.value}>
                            <span className="v2-response-meta-label">{item.label}</span>
                            <span className="v2-response-meta-value">{item.value}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="v2-response-drag-rail v2-response-drag-rail--left" aria-hidden="true" />
            <div className="v2-response-drag-rail v2-response-drag-rail--right" aria-hidden="true" />

            {/* ── Response Body — dynamic height ── */}
            <div
                ref={scrollContainerRef as React.RefObject<HTMLDivElement>}
                className={`v2-scroll-area v2-response-scroll v2-no-drag${isSystemDesignResponse ? ' v2-response-scroll--system-design' : ''}`}
            >
                <AnimatePresence mode="wait">
                    {isProcessing && !renderedResponse?.text ? (
                        <motion.div
                            key="skeleton"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <SkeletonLoader isLightTheme={false} />
                        </motion.div>
                    ) : renderedResponse?.text ? (
                        <motion.div
                            key={`response-${renderedResponse.id}`}
                            initial={{ opacity: 0, y: 6, scale: 0.995 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                            className="v2-response-body"
                        >
                            {/* Negotiation coaching card */}
                            {renderedResponse.isNegotiationCoaching && renderedResponse.negotiationCoachingData ? (
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
                                        {renderedResponse.negotiationCoachingData.phase || 'Negotiation'}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 }}>
                                        {renderedResponse.negotiationCoachingData.tacticalNote}
                                    </div>
                                    {renderedResponse.negotiationCoachingData.exactScript && (
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
                                            "{renderedResponse.negotiationCoachingData.exactScript}"
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <V2ResponseText
                                    text={renderedResponse.text}
                                    isStreaming={!!isStreaming}
                                    isCode={!!renderedResponse.isCode}
                                    actionContract={renderedResponse.actionContract}
                                    diagramChainKey={getDiagramChainKey(renderedResponse)}
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

                            {hasHistory && (
                                <div className="v2-response-switcher" aria-label="Response history navigation">
                                    <button
                                        type="button"
                                        className="v2-response-switcher-btn"
                                        onClick={onPreviousResponse}
                                        disabled={!canGoPreviousResponse}
                                        title="Previous response"
                                        aria-label="Previous response"
                                    >
                                        <ChevronLeft size={14} strokeWidth={2} aria-hidden />
                                    </button>
                                    <span className="v2-response-switcher-count">
                                        Response {activeResponseIndex + 1} of {responseHistoryTotal}
                                    </span>
                                    <button
                                        type="button"
                                        className="v2-response-switcher-btn"
                                        onClick={onNextResponse}
                                        disabled={!canGoNextResponse}
                                        title="Next response"
                                        aria-label="Next response"
                                    >
                                        <ChevronRight size={14} strokeWidth={2} aria-hidden />
                                    </button>
                                    {isPinnedSelection && (
                                        <button
                                            type="button"
                                            className="v2-response-switcher-jump"
                                            onClick={onJumpLatestResponse}
                                            disabled={!canJumpLatestResponse}
                                            title="Jump to latest response"
                                            aria-label="Jump to latest response"
                                        >
                                            <ChevronsRight size={13} strokeWidth={2} aria-hidden />
                                            <span>Jump to Latest</span>
                                        </button>
                                    )}
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

type ResponseMetaItem = {
    label: string;
    value: string;
    title?: string;
};

function buildResponseMetaItems(response: V2Message | null): ResponseMetaItem[] {
    if (!response) return [];

    const ownership = response.ownership;
    const createdAt = ownership?.createdAt ?? response.timestamp;
    const questionTurnId = ownership?.questionTurnId ?? response.questionTurnId;
    const questionTurnTitle = [
        questionTurnId,
        ownership?.transcriptVersion !== undefined ? `Transcript v${ownership.transcriptVersion}` : '',
    ].filter(Boolean).join(' | ');
    const requestedProvider = ownership?.requestedProvider ?? ownership?.sourceProvider ?? response.provider;
    const requestedModel = ownership?.requestedModel ?? ownership?.sourceModel ?? response.model;
    const actualProvider = ownership?.actualProvider ?? requestedProvider;
    const actualModel = ownership?.actualModel ?? requestedModel;
    const routeChanged = Boolean(
        ownership?.routingReason
        || (requestedProvider && actualProvider && requestedProvider !== actualProvider)
        || (requestedModel && actualModel && requestedModel !== actualModel)
    );

    return [
        {
            label: 'Mode',
            value: formatReadableMetaValue(ownership?.mode ?? response.intent),
        },
        {
            label: 'Provider',
            value: formatProviderMetaValue(actualProvider),
            title: buildProviderRouteTitle(requestedProvider, actualProvider),
        },
        {
            label: 'Model',
            value: compactMetaValue(actualModel, 24),
            title: buildModelRouteTitle(requestedModel, actualModel),
        },
        routeChanged ? {
            label: 'Route',
            value: formatRoutingMetaValue({
                requestedProvider,
                requestedModel,
                actualProvider,
                actualModel,
                reason: ownership?.routingReason,
            }),
            title: [
                requestedProvider || requestedModel ? `Requested: ${[requestedProvider, requestedModel].filter(Boolean).join(' / ')}` : '',
                actualProvider || actualModel ? `Actual: ${[actualProvider, actualModel].filter(Boolean).join(' / ')}` : '',
                ownership?.routingReason ? `Reason: ${ownership.routingReason}` : '',
            ].filter(Boolean).join(' | '),
        } : null,
        {
            label: 'Action',
            value: formatReadableMetaValue(ownership?.actionId ?? response.source ?? response.intent),
            title: ownership?.actionId ?? response.source ?? response.intent,
        },
        {
            label: 'Timestamp',
            value: formatResponseTimestamp(createdAt),
            title: createdAt ? new Date(createdAt).toLocaleString() : undefined,
        },
        {
            label: 'Question Turn',
            value: compactMetaValue(questionTurnId, 18),
            title: questionTurnTitle || undefined,
        },
    ].filter((item): item is ResponseMetaItem => Boolean(item && item.value));
}

function formatResponseTimestamp(timestamp?: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function compactMetaValue(value?: string | null, maxLength: number = 18): string {
    const normalized = value?.trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `...${normalized.slice(-(maxLength - 3))}`;
}

function formatReadableMetaValue(value?: string | null): string {
    const normalized = value?.trim();
    if (!normalized) return '';
    return normalized
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatProviderMetaValue(value?: string | null): string {
    const normalized = value?.trim();
    if (!normalized) return '';
    const metadata = getProviderModelMetadata('', { explicitProvider: normalized });
    if (metadata.providerId !== 'custom' || /^custom$/i.test(normalized)) {
        return metadata.providerLabel;
    }
    if (/^openai$/i.test(normalized)) return 'OpenAI';
    if (/^aws$/i.test(normalized)) return 'AWS';
    return formatReadableMetaValue(normalized);
}

function buildProviderRouteTitle(requestedProvider?: string | null, actualProvider?: string | null): string | undefined {
    if (!requestedProvider || !actualProvider || requestedProvider === actualProvider) return undefined;
    return `Requested ${formatProviderMetaValue(requestedProvider)} | Actual ${formatProviderMetaValue(actualProvider)}`;
}

function buildModelRouteTitle(requestedModel?: string | null, actualModel?: string | null): string | undefined {
    if (!requestedModel || !actualModel || requestedModel === actualModel) return actualModel ?? requestedModel ?? undefined;
    return `Requested ${requestedModel} | Actual ${actualModel}`;
}

function formatRoutingMetaValue(args: {
    requestedProvider?: string | null;
    requestedModel?: string | null;
    actualProvider?: string | null;
    actualModel?: string | null;
    reason?: string | null;
}): string {
    if (args.requestedProvider && args.actualProvider && args.requestedProvider !== args.actualProvider) {
        return compactMetaValue(`${formatProviderMetaValue(args.requestedProvider)} -> ${formatProviderMetaValue(args.actualProvider)}`, 22);
    }
    if (args.requestedModel && args.actualModel && args.requestedModel !== args.actualModel) {
        return 'Model remap';
    }
    return compactMetaValue(formatReadableMetaValue(args.reason), 18);
}

function getDiagramChainKey(response: V2Message | null): string | undefined {
    if (!response) return undefined;
    return response.rootResponseId || response.ownership?.parentResponseId || response.id;
}

function isMermaidLanguage(lang: string): boolean {
    const normalized = lang.trim().toLowerCase();
    return normalized === 'mermaid' || normalized.startsWith('mermaid');
}

function normalizeMermaidChart(code: string): string {
    return normalizeMermaidChartSource(code).chart;
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
            return (
                <MermaidRenderer
                    chart={mermaidChart}
                    isLightTheme={false}
                    variant="pro-v2"
                    renderPhase="settled"
                />
            );
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
    if (!/^`{3,4}/.test(part)) return null;
    // Match opening fence: ```lang id="xxx" or ```lang or just ```
    // Strip any trailing attributes (id="...", etc.) from the language line
    const headerMatch = part.match(/^`{3,4}[ \t]*([A-Za-z0-9_#+.-]*)(?:\s+[^\n]*)?\n?/);
    const lang = headerMatch?.[1] || 'text';
    // Remove the opening fence header
    let code = part.replace(/^`{3,4}[ \t]*[^\n]*\n?/, '');
    // Remove closing fence: ``` (proper) or `` (malformed, models often emit 2 backticks)
    code = code.replace(/\n?\s*`{1,4}\s*$/, '');
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
                variant="pro-v2"
                renderPhase={allowOpenMermaid ? 'settled' : 'streaming'}
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

function renderStandardV2ResponseBody(text: string, allowOpenMermaid: boolean) {
    const normalizedText = normalizeV2MermaidMarkdown(text, { isStreaming: !allowOpenMermaid });

    if (!normalizedText.includes('```')) {
        if (allowOpenMermaid) {
            const mermaidStartRe = /(^|\n)\s*(mermaid\b|graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;
            const match = mermaidStartRe.exec(normalizedText);
            if (match) {
                const startIndex = match.index + (match[1] ? match[1].length : 0);
                const before = normalizedText.slice(0, startIndex).trim();
                const chartSource = normalizedText.slice(startIndex).trim();
                return (
                    <>
                        {before && (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={V2_MARKDOWN_COMPONENTS}>
                                {before}
                            </ReactMarkdown>
                        )}
                        <MermaidRenderer
                            chart={chartSource}
                            isLightTheme={false}
                            variant="pro-v2"
                            renderPhase="settled"
                        />
                    </>
                );
            }
        }

        return (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={V2_MARKDOWN_COMPONENTS}>
                {normalizedText}
            </ReactMarkdown>
        );
    }

    // Split on fenced code blocks. Match closing as ``` (proper) or `` on its own line (malformed).
    // Models frequently emit `` instead of ``` as closing fence.
    const parts = normalizedText.split(/(`{3,4}[\s\S]*?(?:\n\s*`{3,4}\s*(?=\n|$)|$))/g);
    return (
        <>
            {parts.map((part, i) => {
                if (/^`{3,4}/.test(part)) {
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

function sanitizeArchitectureMarkdown(text: string): string {
    return text
        .replace(/`{1,2}\s*(?=\n\s*#{1,6}\s*\d+\.)/g, '')
        .replace(/`{1,2}\s*$/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function splitAtArchitectureSection(markdown: string): { before: string; architectureHeader: string; after: string } | null {
    const cleaned = sanitizeArchitectureMarkdown(markdown);
    const headerMatch = /(?:^|\n)\s*#{0,6}\s*4\.\s*Architecture Diagram[^\n]*(?:\n|$)/i.exec(cleaned);
    if (!headerMatch) return null;

    const headerStart = headerMatch.index + (headerMatch[0].startsWith('\n') ? 1 : 0);
    const headerText = headerMatch[0].replace(/^\n/, '').trim();
    const contentStart = headerStart + headerMatch[0].replace(/^\n/, '').length;
    const rest = cleaned.slice(contentStart);
    const nextSectionMatch = /\n\s*#{1,6}\s*(?:5|6|7|8|9|10)\.\s+/i.exec(rest);
    const afterStart = nextSectionMatch ? contentStart + nextSectionMatch.index : cleaned.length;

    return {
        before: cleaned.slice(0, headerStart).trim(),
        architectureHeader: headerText,
        after: cleaned.slice(afterStart).trim(),
    };
}

const diagramAuditSeen = new Set<string>();

function logV2DiagramRenderAudit(text: string, parsedArchitecture: ReturnType<typeof parseArchitectureResponse>, allowOpenMermaid: boolean) {
    if (!/architecture_json|Architecture Diagram|Component Breakdown|Scaling Strategy|system design/i.test(text)) return;
    if (!allowOpenMermaid && parsedArchitecture.state === 'loading') return;

    const key = [
        parsedArchitecture.state,
        parsedArchitecture.diagram?.nodes.length ?? 0,
        parsedArchitecture.fallbackDiagram?.nodes.length ?? 0,
        /```[ \t]*architecture_json\b/i.test(text) ? 'arch' : 'no_arch',
        text.length,
    ].join(':');

    if (diagramAuditSeen.has(key)) return;
    if (diagramAuditSeen.size > 40) diagramAuditSeen.clear();
    diagramAuditSeen.add(key);

    console.log('[V2_DIAGRAM_RENDER_AUDIT]', JSON.stringify({
        state: parsedArchitecture.state,
        diagramNodes: parsedArchitecture.diagram?.nodes.length ?? 0,
        fallbackNodes: parsedArchitecture.fallbackDiagram?.nodes.length ?? 0,
        hasArchitectureJsonFence: /```[ \t]*architecture_json\b/i.test(text),
        hasDiagramKey: /"diagram"\s*:/i.test(text),
        issues: parsedArchitecture.issues,
        length: text.length,
    }));
}

function renderV2ResponseBody(text: string, allowOpenMermaid: boolean, diagramChainKey?: string) {
    const normalizedText = normalizeV2MermaidMarkdown(text, { isStreaming: !allowOpenMermaid });
    const parsedArchitecture = parseArchitectureResponse(normalizedText, { isStreaming: !allowOpenMermaid });
    logV2DiagramRenderAudit(normalizedText, parsedArchitecture, allowOpenMermaid);
    const shouldUseArchitectureRenderer =
        parsedArchitecture.state !== 'missing'
        || Boolean(parsedArchitecture.mermaidChart && looksLikeSystemDesignResponse(normalizedText));

    if (shouldUseArchitectureRenderer) {
        const architectureDiagram = (
            <ArchitectureRenderer
                state={parsedArchitecture.state}
                diagram={parsedArchitecture.diagram}
                mermaidChart={parsedArchitecture.mermaidChart}
                fallbackDiagram={parsedArchitecture.fallbackDiagram}
                isStreaming={!allowOpenMermaid}
                diagramChainKey={diagramChainKey}
            />
        );
        const architectureSplit = parsedArchitecture.markdown
            ? splitAtArchitectureSection(parsedArchitecture.markdown)
            : null;

        if (architectureSplit) {
            return (
                <>
                    {architectureSplit.before && renderStandardV2ResponseBody(architectureSplit.before, allowOpenMermaid)}
                    {architectureSplit.architectureHeader && renderStandardV2ResponseBody(architectureSplit.architectureHeader, allowOpenMermaid)}
                    {architectureDiagram}
                    {architectureSplit.after && renderStandardV2ResponseBody(architectureSplit.after, allowOpenMermaid)}
                </>
            );
        }

        return (
            <>
                {parsedArchitecture.markdown && (
                    <>{renderStandardV2ResponseBody(sanitizeArchitectureMarkdown(parsedArchitecture.markdown), allowOpenMermaid)}</>
                )}
                {architectureDiagram}
            </>
        );
    }

    return renderStandardV2ResponseBody(normalizedText, allowOpenMermaid);
}

function responseContainsMermaid(text: string): boolean {
    const normalizedText = normalizeV2MermaidMarkdown(text, { isStreaming: false });
    return /```[ \t]*mermaid/i.test(normalizedText) || looksLikeMermaidSource(normalizedText);
}

type CodingContractSectionKey = 'Problem' | 'Approach' | 'Complexity' | 'Solution';

interface CodingContractSection {
    key: CodingContractSectionKey;
    content: string;
}

function parseCodingContractSections(text: string): CodingContractSection[] | null {
    if (!text.trim() || responseContainsMermaid(text)) return null;

    const normalized = text.replace(/\r\n?/g, '\n');
    const sectionRegex = /(^|\n)[ \t]*(?:\*\*)?(Problem|Approach|Complexity|Solution)(?:\*\*)?:(?:\*\*)?[ \t]*(?=\n|$)/gi;
    const matches: Array<{ key: CodingContractSectionKey; start: number; end: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = sectionRegex.exec(normalized)) !== null) {
        const rawKey = match[2] as CodingContractSectionKey;
        const lineStartOffset = match[1] ? 1 : 0;
        matches.push({
            key: rawKey,
            start: match.index + lineStartOffset,
            end: match.index + match[0].length,
        });
    }

    if (matches.length < 2) return null;

    const sections = matches
        .map((entry, index) => {
            const next = matches[index + 1];
            return {
                key: entry.key,
                content: normalized.slice(entry.end, next ? next.start : normalized.length).trim(),
            };
        })
        .filter((section) => section.content);

    const seen = new Set(sections.map((section) => section.key));
    const hasContractShape =
        seen.has('Problem')
        && seen.has('Approach')
        && seen.has('Complexity')
        && seen.has('Solution');

    if (!hasContractShape) return null;
    return sections;
}

function renderStructuredCodingContract(text: string, allowOpenMermaid: boolean) {
    const sections = parseCodingContractSections(text);
    if (!sections) return null;

    return (
        <div className="v2-coding-contract">
            <div className="v2-coding-contract-label">Coding Response</div>
            {sections.map((section) => (
                <section className="v2-coding-contract-section" key={section.key}>
                    <div className="v2-coding-contract-section-title">{section.key}</div>
                    <div className="v2-coding-contract-section-body">
                        {renderStandardV2ResponseBody(section.content, allowOpenMermaid)}
                    </div>
                </section>
            ))}
        </div>
    );
}

const V2ResponseText = memo<{
    text: string;
    isStreaming?: boolean;
    isCode?: boolean;
    actionContract?: V2Message['actionContract'];
    diagramChainKey?: string;
}>(function V2ResponseText({ text, isStreaming, isCode, actionContract, diagramChainKey }) {
    // During streaming: render Mermaid blocks that have complete fences.
    // Incomplete / open fences show as raw pre blocks (handled by renderFenceBlock).
    // This ensures completed Mermaid diagrams appear even mid-stream,
    // and the final completed response always triggers a proper render.
    const allowOpenMermaid = !isStreaming;
    const structuredCodingContract = actionContract === 'hint_only'
        || actionContract === 'complexity_only'
        || actionContract === 'edge_cases_only'
        || actionContract === 'debugging_only'
        || actionContract === 'followup_questions_only'
        ? null
        : renderStructuredCodingContract(text, allowOpenMermaid);
    if (structuredCodingContract) return structuredCodingContract;

    const body = renderV2ResponseBody(text, allowOpenMermaid, diagramChainKey);
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
