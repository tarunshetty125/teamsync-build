// src/components/ui/MermaidRenderer.tsx
// Production-grade Mermaid diagram renderer with glassmorphism styling.
// Renders mermaid code blocks as beautiful SVG diagrams inside response cards.

import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Copy, Check, ChevronDown, AlertTriangle } from 'lucide-react';
import mermaid from 'mermaid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MermaidRendererProps {
    chart: string;
    isLightTheme?: boolean;
}

// ---------------------------------------------------------------------------
// Mermaid initialization (once)
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
        themeVariables: isDark
            ? {
                primaryColor: 'rgba(99,102,241,0.85)',
                primaryTextColor: '#E5E7EB',
                primaryBorderColor: 'rgba(99,102,241,0.5)',
                lineColor: 'rgba(148,163,184,0.6)',
                secondaryColor: 'rgba(30,41,59,0.9)',
                tertiaryColor: 'rgba(51,65,85,0.7)',
                background: 'transparent',
                mainBkg: 'rgba(30,41,59,0.85)',
                nodeBorder: 'rgba(99,102,241,0.45)',
                clusterBkg: 'rgba(30,41,59,0.5)',
                clusterBorder: 'rgba(148,163,184,0.2)',
                titleColor: '#E5E7EB',
                edgeLabelBackground: 'rgba(15,23,42,0.85)',
                nodeTextColor: '#E5E7EB',
            }
            : {
                primaryColor: 'rgba(99,102,241,0.15)',
                primaryTextColor: '#1E293B',
                primaryBorderColor: 'rgba(99,102,241,0.35)',
                lineColor: 'rgba(100,116,139,0.5)',
                secondaryColor: 'rgba(241,245,249,0.9)',
                tertiaryColor: 'rgba(226,232,240,0.7)',
                background: 'transparent',
                mainBkg: 'rgba(241,245,249,0.95)',
                nodeBorder: 'rgba(99,102,241,0.3)',
                clusterBkg: 'rgba(241,245,249,0.6)',
                clusterBorder: 'rgba(148,163,184,0.25)',
                titleColor: '#1E293B',
                edgeLabelBackground: 'rgba(255,255,255,0.9)',
                nodeTextColor: '#1E293B',
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
                className="flex items-center gap-1 px-2 py-1 rounded-lg transition-all duration-200"
                style={{
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
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span className="text-[9px] font-medium tracking-wide">
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
    function MermaidRenderer({ chart, isLightTheme = false }) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [svgHtml, setSvgHtml] = useState<string | null>(null);
        const [error, setError] = useState<string | null>(null);
        const [isRendering, setIsRendering] = useState(true);
        const renderIdRef = useRef<string>('');
        const lastChartRef = useRef<string>('');
        const mountedRef = useRef(true);

        useEffect(() => {
            mountedRef.current = true;
            return () => { mountedRef.current = false; };
        }, []);

        useEffect(() => {
            const trimmedChart = chart.trim();

            // Skip empty or unchanged charts
            if (!trimmedChart) {
                setIsRendering(false);
                setError('Empty diagram');
                return;
            }

            // Deduplicate — don't re-render same chart
            if (trimmedChart === lastChartRef.current && svgHtml) return;
            lastChartRef.current = trimmedChart;

            const currentRenderId = getUniqueMermaidId();
            renderIdRef.current = currentRenderId;

            setIsRendering(true);
            setError(null);

            // Initialize mermaid with correct theme
            ensureMermaidInitialized(!isLightTheme);

            // Async render
            (async () => {
                try {
                    const { svg } = await mermaid.render(currentRenderId, trimmedChart);

                    // Only update if this is still the latest render
                    if (!mountedRef.current || renderIdRef.current !== currentRenderId) return;

                    setSvgHtml(svg);
                    setIsRendering(false);
                    setError(null);
                } catch (err: any) {
                    if (!mountedRef.current || renderIdRef.current !== currentRenderId) return;

                    console.warn('[MermaidRenderer] Parse error:', err?.message || err);
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
        }, [chart, isLightTheme]);

        // Error state
        if (error) {
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
                className="my-2.5 rounded-2xl overflow-hidden group/mermaid"
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
                }}
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between px-4 py-2"
                    style={{
                        borderBottom: `1px solid ${isLightTheme ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'}`,
                        background: isLightTheme ? 'rgba(99,102,241,0.02)' : 'rgba(255,255,255,0.015)',
                    }}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-[13px]">📐</span>
                        <span
                            className="text-[10px] font-bold tracking-[0.08em] uppercase"
                            style={{ color: isLightTheme ? 'rgba(99,102,241,0.7)' : 'rgba(129,140,248,0.7)' }}
                        >
                            Architecture Diagram
                        </span>
                    </div>
                    <CopyDiagramButton chart={chart} isLightTheme={isLightTheme} />
                </div>

                {/* Diagram SVG */}
                <div
                    ref={containerRef}
                    className="px-4 py-5 flex items-center justify-center overflow-x-auto"
                    style={{
                        animation: 'mermaidFadeIn 0.4s cubic-bezier(0.22,1,0.36,1) both',
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
                `}</style>
            </div>
        );
    },
);

export default MermaidRenderer;
