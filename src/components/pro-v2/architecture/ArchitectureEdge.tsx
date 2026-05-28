import React, { memo } from 'react';
import {
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    type EdgeProps,
} from '@xyflow/react';
import type { ArchitectureEdgeData } from './architectureLayout';

const ArchitectureEdge = memo<EdgeProps>(function ArchitectureEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
}) {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        curvature: 0.24,
    });
    const edgeData = data as ArchitectureEdgeData | undefined;
    const label = edgeData?.label;

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                markerEnd={markerEnd}
                className="v2-architecture-edge-path"
            />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        className="v2-architecture-edge-label"
                        style={{
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                        }}
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
});

export default ArchitectureEdge;
