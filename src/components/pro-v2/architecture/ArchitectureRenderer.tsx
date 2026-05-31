import React, { Component, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import ArchitectureCanvas from './ArchitectureCanvas';
import type { ArchitectureDiagram } from './architectureSchema';
import type { ArchitectureParseState } from './architectureParser';

interface ArchitectureRendererProps {
    state: ArchitectureParseState;
    diagram: ArchitectureDiagram | null;
    mermaidChart?: string | null;
    fallbackDiagram?: ArchitectureDiagram | null;
    isStreaming?: boolean;
    diagramChainKey?: string;
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

const ArchitectureRenderer = memo<ArchitectureRendererProps>(function ArchitectureRenderer({
    state,
    diagram,
    fallbackDiagram,
    isStreaming = false,
    diagramChainKey,
}) {
    const [stage, setStage] = useState<'flow' | 'cards'>('flow');
    const cardsDiagram = fallbackDiagram ?? diagram ?? null;

    useEffect(() => {
        setStage('flow');
    }, [diagram, state]);

    const handleFlowError = useCallback(() => {
        setStage('cards');
    }, []);

    if (state === 'loading' || (isStreaming && state !== 'ready')) {
        return <ArchitectureLoading />;
    }

    if (stage === 'flow' && state === 'ready' && diagram) {
        return (
            <ArchitectureErrorBoundary onError={handleFlowError}>
                <ArchitectureCanvas
                    diagram={diagram}
                    diagramChainKey={diagramChainKey}
                    onRenderError={handleFlowError}
                />
            </ArchitectureErrorBoundary>
        );
    }

    if ((state === 'invalid' || state === 'missing') && !cardsDiagram) {
        return (
            <div className="v2-architecture-parse-error">
                Architecture diagram JSON could not be parsed. Ask again and I will regenerate it in architecture_json format.
            </div>
        );
    }

    if (!cardsDiagram) return null;
    return <ArchitectureCards diagram={cardsDiagram} />;
});

export default ArchitectureRenderer;
