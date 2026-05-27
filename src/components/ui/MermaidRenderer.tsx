// src/components/ui/MermaidRenderer.tsx
// Production-grade Mermaid diagram renderer with glassmorphism styling.
// Renders mermaid code blocks as beautiful SVG diagrams inside response cards.

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Copy, Check, ChevronDown, AlertTriangle } from 'lucide-react';
import mermaid from 'mermaid';
import { normalizeMermaidChartSource } from '../../lib/overlay/v2Mermaid';

// ---------------------------------------------------------------------------
// Normalization — hardened for streamed / malformed model output
// ---------------------------------------------------------------------------

function normalizeMermaidSource(input: string): { chart: string; diagramType: string; issues: string[] } {
    const normalized = normalizeMermaidChartSource(input);
    return {
        chart: normalized.chart,
        diagramType: normalized.diagramType,
        issues: normalized.issues,
    };
}

// ---------------------------------------------------------------------------
// Detect diagram type for logging
// ---------------------------------------------------------------------------

function detectDiagramType(source: string): string {
    const first = source.trim().split(/[\s\n]/)[0]?.toLowerCase() || 'unknown';
    const types = [
        'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
        'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey',
        'gantt', 'pie', 'mindmap', 'timeline', 'gitGraph',
        'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
    ];
    for (const t of types) {
        if (first === t.toLowerCase()) return t;
    }
    return first;
}

// ---------------------------------------------------------------------------
// SVG post-processing — inject override styles & make responsive
// ---------------------------------------------------------------------------

function normalizeMermaidSvg(
    svg: string,
    isLightTheme: boolean,
    variant: 'default' | 'pro-v2' = 'default',
): string {
    let out = svg;

    // Mermaid sometimes emits fixed width/height on the root <svg>; prefer responsive via viewBox.
    // IMPORTANT: Only strip from the root <svg>, NOT from child elements like <rect>, <foreignObject>.
    // Stripping width/height from rects/foreignObjects collapses nodes to 0×0 (arrows-only bug).
    out = out.replace(
        /(<svg\s)([^>]*?)>/i,
        (_m, svgOpen, attrs) => {
            const cleanedAttrs = attrs.replace(/\s?(width|height)="[^"]*"/g, '');
            return `${svgOpen}${cleanedAttrs}>`;
        },
    );

    const useCementPalette = variant === 'pro-v2' && !isLightTheme;
    const overrideStyleMarker = 'data-mermaid-override="true"';
    const nodeFill = isLightTheme
        ? 'rgba(99,102,241,0.08)'
        : (useCementPalette ? 'rgba(148,163,184,0.14)' : 'rgba(99,102,241,0.18)');
    const nodeStroke = isLightTheme
        ? 'rgba(99,102,241,0.35)'
        : (useCementPalette ? 'rgba(214,211,209,0.38)' : 'rgba(129,140,248,0.65)');
    const nodeText = isLightTheme ? '#1F2937' : (useCementPalette ? '#E7E5E4' : '#F3F4F6');
    const edgeStroke = isLightTheme
        ? 'rgba(100,116,139,0.6)'
        : (useCementPalette ? 'rgba(168,162,158,0.7)' : 'rgba(148,163,184,0.65)');
    const labelBg = isLightTheme
        ? 'rgba(255,255,255,0.9)'
        : (useCementPalette ? 'rgba(41,37,36,0.9)' : 'rgba(15,23,42,0.85)');
    const clusterFill = isLightTheme
        ? 'rgba(241,245,249,0.6)'
        : (useCementPalette ? 'rgba(68,64,60,0.34)' : 'rgba(30,41,59,0.5)');
    const clusterStroke = isLightTheme
        ? 'rgba(148,163,184,0.35)'
        : (useCementPalette ? 'rgba(168,162,158,0.26)' : 'rgba(148,163,184,0.2)');
    const noteFill = isLightTheme
        ? 'rgba(255,255,255,0.9)'
        : (useCementPalette ? 'rgba(41,37,36,0.92)' : 'rgba(30,41,59,0.9)');
    const noteStroke = isLightTheme
        ? 'rgba(100,116,139,0.35)'
        : (useCementPalette ? 'rgba(168,162,158,0.48)' : 'rgba(148,163,184,0.45)');
    const actorBg = isLightTheme
        ? 'rgba(241,245,249,0.95)'
        : (useCementPalette ? 'rgba(68,64,60,0.76)' : 'rgba(30,41,59,0.85)');
    const actorStroke = isLightTheme
        ? 'rgba(100,116,139,0.4)'
        : (useCementPalette ? 'rgba(168,162,158,0.64)' : 'rgba(148,163,184,0.6)');
    const actorLine = isLightTheme
        ? 'rgba(100,116,139,0.5)'
        : (useCementPalette ? 'rgba(168,162,158,0.56)' : 'rgba(148,163,184,0.5)');

    const overrideStyle = `<style ${overrideStyleMarker}>
    /* ── Global text visibility ── */
    text, tspan {
        fill: ${nodeText} !important;
        color: ${nodeText} !important;
        opacity: 1 !important;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    /* ── foreignObject (html labels) ── */
    foreignObject {
        overflow: visible !important;
    }
    foreignObject * {
        color: ${nodeText} !important;
        opacity: 1 !important;
    }
    foreignObject div, foreignObject span, foreignObject p {
        color: ${nodeText} !important;
        fill: ${nodeText} !important;
    }
    /* ── Flowchart / Graph nodes ── */
    .node rect, .node polygon, .node ellipse, .node circle, .node path {
        fill: ${nodeFill};
        stroke: ${nodeStroke};
        stroke-width: 1.2px;
    }
    .node text, .nodeLabel, .label text, .edgeLabel text {
        fill: ${nodeText} !important;
        color: ${nodeText} !important;
    }
    /* ── Decision / rhombus ── */
    .node polygon {
        fill: ${nodeFill};
        stroke: ${nodeStroke};
    }
    /* ── Edges ── */
    .edgePath path, .flowchart-link {
        stroke: ${edgeStroke} !important;
    }
    .edgeLabel, .label {
        background: ${labelBg};
    }
    /* ── Subgraphs / clusters ── */
    .cluster rect {
        fill: ${clusterFill};
        stroke: ${clusterStroke};
    }
    .cluster text {
        fill: ${nodeText} !important;
    }
    /* ── Sequence Diagram — actors, messages, notes ── */
    .actor rect, .actor {
        fill: ${actorBg} !important;
        stroke: ${actorStroke} !important;
    }
    .actor-line, .messageLine0, .messageLine1 {
        stroke: ${actorLine} !important;
    }
    text.actor > tspan {
        fill: ${nodeText} !important;
        font-weight: 500;
    }
    .messageText, .loopText, .labelText {
        fill: ${nodeText} !important;
        color: ${nodeText} !important;
    }
    .sequenceNumber {
        fill: ${nodeText} !important;
    }
    .activation0, .activation1, .activation2 {
        fill: ${isLightTheme ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.25)'} !important;
        stroke: ${nodeStroke} !important;
    }
    /* ── Notes ── */
    .note rect, .note {
        fill: ${noteFill};
        stroke: ${noteStroke};
    }
    .note text, .noteText {
        fill: ${nodeText} !important;
    }
    /* ── State diagrams ── */
    .stateGroup rect {
        fill: ${nodeFill} !important;
        stroke: ${nodeStroke} !important;
    }
    .stateGroup text {
        fill: ${nodeText} !important;
    }
    .statediagram-state .state-title {
        fill: ${nodeText} !important;
    }
    /* ── Class diagrams ── */
    .classGroup rect {
        fill: ${nodeFill} !important;
        stroke: ${nodeStroke} !important;
    }
    .classGroup text, .classLabel text {
        fill: ${nodeText} !important;
    }
    /* ── Labels (edge labels, etc.) ── */
    .labelBox {
        fill: ${labelBg} !important;
        stroke: ${noteStroke} !important;
    }
    .labelText, .loopText {
        fill: ${nodeText} !important;
    }
    /* ── Arrowheads ── */
    marker path {
        fill: ${edgeStroke} !important;
        stroke: ${edgeStroke} !important;
    }
    /* ── Prevent parent opacity/filter leaking ── */
    .mermaid-container svg {
        opacity: 1 !important;
        filter: none !important;
        mix-blend-mode: normal !important;
    }
    </style>`;

    // Ensure SVG scales to container width.
    out = out.replace(
        /<svg([^>]*?)>/i,
        (_m, attrs) => {
            const hasStyle = /style="/i.test(attrs);
            const stylePatch = 'style="max-width:100%;height:auto;display:block;"';
            const injectedStyle = out.includes(overrideStyleMarker) ? '' : overrideStyle;
            return `<svg${attrs} ${hasStyle ? '' : stylePatch}>${injectedStyle}`;
        },
    );
    return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MermaidRendererProps {
    chart: string;
    isLightTheme?: boolean;
    renderPhase?: 'streaming' | 'settled';
    variant?: 'default' | 'pro-v2';
}

// ---------------------------------------------------------------------------
// Mermaid initialization (once per theme)
// ---------------------------------------------------------------------------

let mermaidInitialized = false;
let currentMermaidTheme: string | null = null;

function ensureMermaidInitialized(isDark: boolean) {
    const targetTheme = isDark ? 'dark' : 'default';
    if (mermaidInitialized && currentMermaidTheme === targetTheme) return;

    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: targetTheme,
        suppressErrorRendering: true,
        fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 13,
        flowchart: {
            htmlLabels: true,
            curve: 'basis',
            padding: 12,
            nodeSpacing: 50,
            rankSpacing: 50,
            useMaxWidth: true,
        },
        sequence: {
            actorMargin: 50,
            boxMargin: 10,
            boxTextMargin: 5,
            noteMargin: 10,
            messageMargin: 35,
            mirrorActors: true,
            useMaxWidth: true,
        },
        themeVariables: isDark
            ? {
                primaryColor: 'rgba(99,102,241,0.85)',
                primaryTextColor: '#F3F4F6',
                textColor: '#F3F4F6',
                labelTextColor: '#F3F4F6',
                actorTextColor: '#F3F4F6',
                primaryBorderColor: 'rgba(99,102,241,0.5)',
                lineColor: 'rgba(148,163,184,0.6)',
                signalColor: 'rgba(148,163,184,0.6)',
                signalTextColor: '#F3F4F6',
                secondaryColor: 'rgba(30,41,59,0.9)',
                tertiaryColor: 'rgba(51,65,85,0.7)',
                background: 'transparent',
                mainBkg: 'rgba(30,41,59,0.85)',
                actorBkg: '#1F2937',
                actorBorder: '#9CA3AF',
                actorLineColor: 'rgba(148,163,184,0.6)',
                nodeBorder: 'rgba(99,102,241,0.45)',
                clusterBkg: 'rgba(30,41,59,0.5)',
                clusterBorder: 'rgba(148,163,184,0.2)',
                titleColor: '#F3F4F6',
                edgeLabelBackground: 'rgba(15,23,42,0.85)',
                nodeTextColor: '#F3F4F6',
                noteTextColor: '#F3F4F6',
                noteBkgColor: '#111827',
                noteBorderColor: 'rgba(148,163,184,0.5)',
            }
            : {
                primaryColor: 'rgba(99,102,241,0.15)',
                primaryTextColor: '#1E293B',
                textColor: '#1E293B',
                labelTextColor: '#1E293B',
                actorTextColor: '#1E293B',
                primaryBorderColor: 'rgba(99,102,241,0.35)',
                lineColor: 'rgba(100,116,139,0.5)',
                signalColor: 'rgba(100,116,139,0.5)',
                signalTextColor: '#1E293B',
                secondaryColor: 'rgba(241,245,249,0.9)',
                tertiaryColor: 'rgba(226,232,240,0.7)',
                background: 'transparent',
                mainBkg: 'rgba(241,245,249,0.95)',
                actorBkg: 'rgba(241,245,249,0.95)',
                actorBorder: 'rgba(100,116,139,0.4)',
                actorLineColor: 'rgba(100,116,139,0.5)',
                nodeBorder: 'rgba(99,102,241,0.3)',
                clusterBkg: 'rgba(241,245,249,0.6)',
                clusterBorder: 'rgba(148,163,184,0.25)',
                titleColor: '#1E293B',
                edgeLabelBackground: 'rgba(255,255,255,0.9)',
                nodeTextColor: '#1E293B',
                noteTextColor: '#1E293B',
                noteBkgColor: 'rgba(241,245,249,0.9)',
                noteBorderColor: 'rgba(100,116,139,0.35)',
            },
    });

    mermaidInitialized = true;
    currentMermaidTheme = targetTheme;
}

// ---------------------------------------------------------------------------
// Unique ID counter (no collisions across renders)
// ---------------------------------------------------------------------------

let mermaidIdCounter = 0;
function getUniqueMermaidId(): string {
    return `mermaid-diagram-${Date.now()}-${++mermaidIdCounter}`;
}

// ---------------------------------------------------------------------------
// CopyDiagramButton (internal)
// ---------------------------------------------------------------------------

const CopyDiagramButton = memo<{ chart: string; isLightTheme: boolean }>(
    function CopyDiagramButton({ chart, isLightTheme }) {
        const [copied, setCopied] = useState(false);

        const handleCopy = useCallback(() => {
            navigator.clipboard.writeText(chart);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }, [chart]);

        return (
            <button
                onClick={handleCopy}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 10,
                    transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.15s ease',
                    background: copied
                        ? (isLightTheme ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.12)')
                        : (isLightTheme ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'),
                    border: `1px solid ${copied
                        ? 'rgba(34,197,94,0.20)'
                        : (isLightTheme ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)')}`,
                    color: copied
                        ? '#22C55E'
                        : (isLightTheme ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)'),
                }}
                title={copied ? 'Copied!' : 'Copy diagram source'}
            >
                {copied ? <Check width={12} height={12} /> : <Copy width={12} height={12} />}
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.04em' }}>
                    {copied ? 'Copied' : 'Copy Diagram'}
                </span>
            </button>
        );
    },
);

// ---------------------------------------------------------------------------
// ErrorFallback (internal)
// ---------------------------------------------------------------------------

const ErrorFallback = memo<{ chart: string; error: string; isLightTheme: boolean }>(
    function ErrorFallback({ chart, error: _error, isLightTheme }) {
        const [showSource, setShowSource] = useState(false);

        return (
            <div
                className="my-2.5 rounded-2xl overflow-hidden"
                style={{
                    background: isLightTheme
                        ? 'rgba(239,68,68,0.04)'
                        : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${isLightTheme ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.15)'}`,
                    backdropFilter: 'blur(12px)',
                }}
            >
                <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                        <AlertTriangle
                            className="w-3.5 h-3.5"
                            style={{ color: isLightTheme ? '#DC2626' : '#FCA5A5' }}
                        />
                        <span
                            className="text-[11px] font-semibold tracking-wide"
                            style={{ color: isLightTheme ? '#DC2626' : '#FCA5A5' }}
                        >
                            Unable to render architecture diagram
                        </span>
                    </div>
                    <button
                        onClick={() => setShowSource(!showSource)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg transition-all duration-200"
                        style={{
                            background: isLightTheme ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${isLightTheme ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}`,
                            color: isLightTheme ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
                        }}
                    >
                        <span className="text-[9px] font-medium tracking-wide">
                            {showSource ? 'Hide Source' : 'Show Source'}
                        </span>
                        <ChevronDown
                            className={`w-3 h-3 transition-transform duration-200 ${showSource ? 'rotate-180' : ''}`}
                        />
                    </button>
                </div>
                {showSource && (
                    <div
                        className="px-4 pb-3"
                        style={{
                            borderTop: `1px solid ${isLightTheme ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'}`,
                        }}
                    >
                        <pre
                            className="mt-2 p-3 rounded-xl text-[11px] font-mono leading-relaxed overflow-x-auto"
                            style={{
                                background: isLightTheme ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.25)',
                                color: isLightTheme ? '#64748B' : '#94A3B8',
                                border: `1px solid ${isLightTheme ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'}`,
                            }}
                        >
                            {chart}
                        </pre>
                    </div>
                )}
            </div>
        );
    },
);

// ---------------------------------------------------------------------------
// MermaidRenderer — Main Component
// ---------------------------------------------------------------------------

const MermaidRenderer: React.FC<MermaidRendererProps> = memo(
    function MermaidRenderer({
        chart,
        isLightTheme = false,
        renderPhase = 'settled',
        variant = 'default',
    }) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [svgHtml, setSvgHtml] = useState<string | null>(null);
        const [error, setError] = useState<string | null>(null);
        const [isRendering, setIsRendering] = useState(true);
        const renderIdRef = useRef<string>('');
        const lastChartRef = useRef<string>('');
        const lastFailedChartRef = useRef<string>('');
        const retryCountRef = useRef<number>(0);
        const mountedRef = useRef(true);

        useEffect(() => {
            mountedRef.current = true;
            return () => { mountedRef.current = false; };
        }, []);

        useEffect(() => {
            const normalized = normalizeMermaidSource(chart);
            const trimmedChart = normalized.chart;

            // Skip empty charts
            if (!trimmedChart) {
                setIsRendering(false);
                setError('Empty diagram');
                return;
            }

            // Deduplicate — don't re-render same chart that already succeeded
            const renderFingerprint = `${renderPhase}:${trimmedChart}`;
            if (renderFingerprint === lastChartRef.current && svgHtml) return;

            // If this is the same chart that previously failed, allow a retry
            // (the chart prop changed → stream completed → re-render attempt)
            const isRetryOfFailed = renderFingerprint === lastFailedChartRef.current;
            if (isRetryOfFailed && retryCountRef.current >= 2) {
                // Already retried twice for this exact source, don't loop
                return;
            }

            lastChartRef.current = renderFingerprint;

            const currentRenderId = getUniqueMermaidId();
            renderIdRef.current = currentRenderId;

            setIsRendering(true);
            setError(null);

            const diagramType = normalized.diagramType || detectDiagramType(trimmedChart);

            // Initialize mermaid with correct theme
            ensureMermaidInitialized(!isLightTheme);

            // Async render
            (async () => {
                try {
                    const { svg } = await mermaid.render(currentRenderId, trimmedChart);

                    // Only update if this is still the latest render
                    if (!mountedRef.current || renderIdRef.current !== currentRenderId) return;

                    setSvgHtml(normalizeMermaidSvg(svg, isLightTheme, variant));
                    setIsRendering(false);
                    setError(null);
                    lastFailedChartRef.current = '';
                    retryCountRef.current = 0;
                } catch (err: any) {
                    if (!mountedRef.current || renderIdRef.current !== currentRenderId) return;

                    console.warn('[MermaidRenderer]', {
                        normalizedSource: trimmedChart,
                        diagramType,
                        repairs: normalized.issues,
                        renderPhase,
                        error: err,
                    });

                    lastFailedChartRef.current = renderFingerprint;
                    retryCountRef.current += 1;
                    setError(err?.message || 'Failed to parse diagram');
                    setIsRendering(false);

                    // Clean up any stale render containers mermaid may have inserted
                    const staleEl = document.getElementById(currentRenderId);
                    staleEl?.remove();
                }
            })();

            return () => {
                // Clean up stale SVG container on unmount or re-render
                const staleEl = document.getElementById(currentRenderId);
                staleEl?.remove();
            };
        }, [chart, isLightTheme, renderPhase, variant]);

        // Error state
        if (error) {
            if (variant === 'pro-v2' && renderPhase === 'streaming') {
                return <pre className="v2-response-pre v2-response-pre--streaming">{chart}</pre>;
            }
            return <ErrorFallback chart={chart} error={error} isLightTheme={isLightTheme} />;
        }

        // Loading state
        if (isRendering || !svgHtml) {
            return (
                <div
                    className="my-2.5 rounded-2xl overflow-hidden flex items-center justify-center"
                    style={{
                        minHeight: '120px',
                        background: isLightTheme
                            ? 'rgba(99,102,241,0.03)'
                            : 'rgba(99,102,241,0.04)',
                        border: `1px solid ${isLightTheme ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.10)'}`,
                        backdropFilter: 'blur(12px)',
                    }}
                >
                    <div className="flex items-center gap-2.5 px-4 py-3">
                        <div
                            className="w-4 h-4 rounded-full animate-spin"
                            style={{
                                border: `2px solid ${isLightTheme ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.2)'}`,
                                borderTopColor: isLightTheme ? 'rgba(99,102,241,0.6)' : 'rgba(129,140,248,0.7)',
                            }}
                        />
                        <span
                            className="text-[11px] font-medium tracking-wide"
                            style={{ color: isLightTheme ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)' }}
                        >
                            Rendering diagram…
                        </span>
                    </div>
                </div>
            );
        }

        // Rendered diagram
        return (
            <div
                className="mermaid-container my-2.5 rounded-2xl overflow-hidden group/mermaid"
                style={{
                    background: isLightTheme
                        ? 'linear-gradient(135deg, rgba(241,245,249,0.7) 0%, rgba(99,102,241,0.03) 100%)'
                        : 'linear-gradient(135deg, rgba(15,23,42,0.5) 0%, rgba(99,102,241,0.06) 100%)',
                    border: `1px solid ${isLightTheme ? 'rgba(99,102,241,0.10)' : 'rgba(99,102,241,0.12)'}`,
                    boxShadow: isLightTheme
                        ? '0 2px 12px rgba(99,102,241,0.06), inset 0 1px 0 rgba(255,255,255,0.8)'
                        : '0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.03)',
                    backdropFilter: 'blur(16px) saturate(130%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(130%)',
                    transition: 'box-shadow 0.3s ease, transform 0.3s ease',
                    isolation: 'isolate',
                    opacity: 1,
                }}
            >
                {/* Header */}
                <div
                    className="px-4 py-2"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: `1px solid ${isLightTheme ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'}`,
                        background: isLightTheme ? 'rgba(99,102,241,0.02)' : 'rgba(255,255,255,0.015)',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minWidth: 0,
                        }}
                    >
                        <span style={{ fontSize: 13 }}>📐</span>
                        <span
                            style={{ color: isLightTheme ? 'rgba(99,102,241,0.7)' : 'rgba(129,140,248,0.7)' }}
                        >
                            <span
                                style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                }}
                            >
                                Architecture Diagram
                            </span>
                        </span>
                    </div>
                    <CopyDiagramButton chart={chart} isLightTheme={isLightTheme} />
                </div>

                {/* Diagram SVG */}
                <div
                    ref={containerRef}
                    className="px-4 py-5 overflow-x-auto mermaid"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'mermaidFadeIn 0.4s cubic-bezier(0.22,1,0.36,1) both',
                        opacity: 1,
                    }}
                    dangerouslySetInnerHTML={{ __html: svgHtml }}
                />

                {/* Inline keyframes */}
                <style>{`
                    @keyframes mermaidFadeIn {
                        from { opacity: 0; transform: translateY(6px) scale(0.98); }
                        to   { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    .group\\/mermaid:hover {
                        box-shadow: ${isLightTheme
                        ? '0 4px 20px rgba(99,102,241,0.10), inset 0 1px 0 rgba(255,255,255,0.8)'
                        : '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)'
                    } !important;
                    }
                    .group\\/mermaid svg {
                        max-width: 100%;
                        height: auto;
                    }
                `}
                </style>
            </div>
        );
    },
);

export default MermaidRenderer;
