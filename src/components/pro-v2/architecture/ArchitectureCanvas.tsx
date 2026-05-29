import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    MarkerType,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type EdgeTypes,
    type NodeTypes,
} from '@xyflow/react';
import { motion } from 'framer-motion';
import '@xyflow/react/dist/style.css';
import type { ArchitectureDiagram } from './architectureSchema';
import {
    architectureDiagramFingerprint,
    layoutArchitectureDiagram,
    type ArchitectureFlowEdge,
    type ArchitectureFlowNode,
} from './architectureLayout';
import ArchitectureNode from './ArchitectureNode';
import ArchitectureEdge from './ArchitectureEdge';

const nodeTypes: NodeTypes = { architecture: ArchitectureNode };
const edgeTypes: EdgeTypes = { architecture: ArchitectureEdge };

function getViewportSettings(nodeCount: number) {
    if (nodeCount >= 35) {
        return { padding: 0.18, minZoom: 0.12, maxZoom: 1.05, defaultZoom: 0.36 };
    }
    if (nodeCount >= 20) {
        return { padding: 0.15, minZoom: 0.18, maxZoom: 1.15, defaultZoom: 0.48 };
    }
    return { padding: 0.12, minZoom: 0.28, maxZoom: 1.25, defaultZoom: 0.72 };
}

interface ArchitectureCanvasProps {
    diagram: ArchitectureDiagram;
    onRenderError: (error: unknown) => void;
}

function ArchitectureSkeleton() {
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

const ArchitectureFlowInner = memo<ArchitectureCanvasProps>(function ArchitectureFlowInner({ diagram, onRenderError }) {
    const diagramKey = useMemo(() => architectureDiagramFingerprint(diagram), [diagram]);
    const [nodes, setNodes] = useState<ArchitectureFlowNode[]>([]);
    const [edges, setEdges] = useState<ArchitectureFlowEdge[]>([]);
    const [isLayoutReady, setIsLayoutReady] = useState(false);
    const requestSeqRef = useRef(0);
    const { fitView } = useReactFlow();
    const viewportSettings = useMemo(() => getViewportSettings(diagram.nodes.length), [diagram.nodes.length]);

    useEffect(() => {
        let cancelled = false;
        const requestSeq = ++requestSeqRef.current;
        setIsLayoutReady(false);

        layoutArchitectureDiagram(diagram)
            .then((result) => {
                if (cancelled || requestSeq !== requestSeqRef.current) return;
                setNodes(result.nodes);
                setEdges(result.edges.map((edge) => ({
                    ...edge,
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        width: 16,
                        height: 16,
                        color: 'rgba(226,232,240,0.54)',
                    },
                })));
                setIsLayoutReady(true);
                window.requestAnimationFrame(() => {
                    fitView({
                        padding: viewportSettings.padding,
                        duration: 420,
                        minZoom: viewportSettings.minZoom,
                        maxZoom: viewportSettings.maxZoom,
                    });
                });
            })
            .catch((error) => {
                if (cancelled) return;
                onRenderError(error);
            });

        return () => {
            cancelled = true;
        };
        // diagramKey intentionally owns layout invalidation; diagram is the matching value for that fingerprint.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diagramKey, fitView, onRenderError, viewportSettings.maxZoom, viewportSettings.minZoom, viewportSettings.padding]);

    if (!isLayoutReady) return <ArchitectureSkeleton />;

    return (
        <motion.div
            className="v2-architecture-shell"
            initial={{ opacity: 0, y: 6, scale: 0.992 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                minZoom={viewportSettings.minZoom}
                maxZoom={viewportSettings.maxZoom}
                defaultViewport={{ x: 0, y: 0, zoom: viewportSettings.defaultZoom }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag
                panOnScroll
                zoomOnScroll={false}
                zoomOnPinch
                preventScrolling={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="rgba(255,255,255,0.12)" gap={24} size={0.7} />
            </ReactFlow>
        </motion.div>
    );
});

const ArchitectureCanvas = memo<ArchitectureCanvasProps>(function ArchitectureCanvas(props) {
    return (
        <ReactFlowProvider>
            <ArchitectureFlowInner {...props} />
        </ReactFlowProvider>
    );
});

export default ArchitectureCanvas;
