import React, { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import mermaid from 'mermaid';
import ArchitectureCanvas from './ArchitectureCanvas';
import type { ArchitectureDiagram } from './architectureSchema';
import { createLinearFallbackDiagram } from './architectureSchema';
import type { ArchitectureParseState } from './architectureParser';

interface ArchitectureRendererProps {
    state: ArchitectureParseState;
    diagram: ArchitectureDiagram | null;
    mermaidChart?: string | null;
    fallbackDiagram?: ArchitectureDiagram | null;
    isStreaming?: boolean;
}

interface ArchitectureErrorBoundaryProps {
    onError: (error: unknown) => void;
    children: React.ReactNode;
}

class ArchitectureErrorBoundary extends Component<ArchitectureErrorBoundaryProps, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: unknown) {
        this.props.onError(error);
    }

    componentDidUpdate(prevProps: ArchitectureErrorBoundaryProps) {
        if (prevProps.children !== this.props.children && this.state.hasError) {
            this.setState({ hasError: false });
        }
    }

    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

function ArchitectureLoading() {
    return (
        <div className="v2-architecture-shell v2-architecture-shell--loading">
            <div className="v2-architecture-skeleton-grid">
                <div className="v2-architecture-skeleton-node" />
                <div className="v2-architecture-skeleton-line" />
                <div className="v2-architecture-skeleton-node v2-architecture-skeleton-node--wide" />
                <div className="v2-architecture-skeleton-line" />
                <div className="v2-architecture-skeleton-row">
                    <div className="v2-architecture-skeleton-node" />
                    <div className="v2-architecture-skeleton-node" />
                </div>
            </div>
        </div>
    );
}

function ArchitectureCards({ diagram }: { diagram: ArchitectureDiagram }) {
    const nodes = diagram.nodes.slice(0, 10);
    const edgeLabelByPair = useMemo(() => {
        const map = new Map<string, string>();
        diagram.edges.forEach((edge) => {
            if (edge.label) map.set(`${edge.source}->${edge.target}`, edge.label);
        });
        return map;
    }, [diagram.edges]);

    return (
        <motion.div
            className="v2-architecture-cards"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
            {nodes.map((node, index) => {
                const next = nodes[index + 1];
                const label = next ? edgeLabelByPair.get(`${node.id}->${next.id}`) : null;
                return (
                    <React.Fragment key={node.id}>
                        <div className={`v2-architecture-card v2-architecture-card--${node.kind}`}>
                            <span className="v2-architecture-card-kind">{node.kind}</span>
                            <span className="v2-architecture-card-label">{node.label}</span>
                        </div>
                        {next && (
                            <div className="v2-architecture-card-connector">
                                <span />
                                {label && <em>{label}</em>}
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </motion.div>
    );
}

let architectureMermaidCounter = 0;
function nextArchitectureMermaidId() {
    architectureMermaidCounter += 1;
    return `v2-architecture-mermaid-${Date.now()}-${architectureMermaidCounter}`;
}

function MermaidGuard({ chart, fallbackDiagram }: { chart: string; fallbackDiagram: ArchitectureDiagram }) {
    const renderIdRef = useRef('');
    const [svgHtml, setSvgHtml] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const renderId = nextArchitectureMermaidId();
        renderIdRef.current = renderId;
        setSvgHtml(null);
        setFailed(false);

        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'dark',
            suppressErrorRendering: true,
            fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 13,
            flowchart: {
                htmlLabels: true,
                curve: 'basis',
                padding: 12,
                nodeSpacing: 50,
                rankSpacing: 54,
                useMaxWidth: true,
            },
            themeVariables: {
                background: 'transparent',
                mainBkg: 'rgba(31,31,35,0.94)',
                primaryColor: '#1F1F23',
                primaryTextColor: '#F5F5F7',
                primaryBorderColor: 'rgba(255,255,255,0.12)',
                lineColor: 'rgba(255,255,255,0.26)',
                textColor: '#F5F5F7',
                nodeTextColor: '#F5F5F7',
                edgeLabelBackground: 'rgba(24,24,28,0.88)',
                clusterBkg: 'rgba(255,255,255,0.03)',
                clusterBorder: 'rgba(255,255,255,0.08)',
            },
        });

        (async () => {
            try {
                const parsed = await mermaid.parse(chart, { suppressErrors: true });
                if (parsed === false) throw new Error('Invalid Mermaid');
                const { svg } = await mermaid.render(renderId, chart);
                if (cancelled || renderIdRef.current !== renderId) return;
                const responsiveSvg = svg.replace(/(<svg\s)([^>]*?)>/i, (_match, svgOpen, attrs) => {
                    const cleanedAttrs = String(attrs).replace(/\s?(width|height)="[^"]*"/g, '');
                    return `${svgOpen}${cleanedAttrs}>`;
                });
                setSvgHtml(responsiveSvg);
            } catch {
                if (!cancelled) setFailed(true);
            } finally {
                document.getElementById(renderId)?.remove();
            }
        })();

        return () => {
            cancelled = true;
            document.getElementById(renderId)?.remove();
        };
    }, [chart]);

    if (failed) return <ArchitectureCards diagram={fallbackDiagram} />;
    if (!svgHtml) return <ArchitectureLoading />;

    return (
        <motion.div
            className="mermaid-container v2-architecture-mermaid-fallback my-2.5 rounded-2xl overflow-hidden group/mermaid"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="v2-architecture-mermaid-header">
                Architecture Diagram
            </div>
            <div
                className="v2-architecture-mermaid-body mermaid"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
        </motion.div>
    );
}

const ArchitectureRenderer = memo<ArchitectureRendererProps>(function ArchitectureRenderer({
    state,
    diagram,
    mermaidChart,
    fallbackDiagram,
    isStreaming = false,
}) {
    const [stage, setStage] = useState<'flow' | 'mermaid' | 'cards'>('flow');
    const cardsDiagram = fallbackDiagram ?? diagram ?? createLinearFallbackDiagram([]);

    useEffect(() => {
        setStage('flow');
    }, [diagram, mermaidChart, state]);

    const handleFlowError = useCallback(() => {
        setStage(mermaidChart ? 'mermaid' : 'cards');
    }, [mermaidChart]);

    if (state === 'loading' || (isStreaming && state !== 'ready' && !mermaidChart)) {
        return <ArchitectureLoading />;
    }

    if (stage === 'flow' && state === 'ready' && diagram) {
        return (
            <ArchitectureErrorBoundary onError={handleFlowError}>
                <ArchitectureCanvas diagram={diagram} onRenderError={handleFlowError} />
            </ArchitectureErrorBoundary>
        );
    }

    if ((stage === 'mermaid' || state === 'missing' || state === 'invalid') && mermaidChart) {
        return <MermaidGuard chart={mermaidChart} fallbackDiagram={cardsDiagram} />;
    }

    return <ArchitectureCards diagram={cardsDiagram} />;
});

export default ArchitectureRenderer;
