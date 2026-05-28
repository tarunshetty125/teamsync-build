import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
    Cable,
    Database,
    Globe2,
    HardDrive,
    List,
    MemoryStick,
    Monitor,
    Router,
    Server,
} from 'lucide-react';
import type { ArchitectureFlowNode } from './architectureLayout';
import { ARCHITECTURE_KIND_STYLES } from './architectureStyles';

const ICONS = {
    client: Monitor,
    gateway: Router,
    service: Server,
    database: Database,
    cache: MemoryStick,
    queue: List,
    storage: HardDrive,
    external: Globe2,
};

function handlePositions(direction: ArchitectureFlowNode['data']['direction']) {
    if (direction === 'LR') return { source: Position.Right, target: Position.Left };
    if (direction === 'RL') return { source: Position.Left, target: Position.Right };
    if (direction === 'BT') return { source: Position.Top, target: Position.Bottom };
    return { source: Position.Bottom, target: Position.Top };
}

const ArchitectureNode = memo<NodeProps<ArchitectureFlowNode>>(function ArchitectureNode({ data }) {
    const style = ARCHITECTURE_KIND_STYLES[data.kind];
    const Icon = ICONS[data.kind] ?? Cable;
    const positions = handlePositions(data.direction);

    return (
        <div
            className={`v2-architecture-node v2-architecture-node--${data.kind} ${data.emphasized ? 'v2-architecture-node--emphasized' : ''}`}
            style={{
                borderColor: style.border,
                background: `linear-gradient(180deg, rgba(255,255,255,0.105) 0%, rgba(255,255,255,0.045) 100%), ${style.tint}`,
            }}
        >
            <Handle type="target" position={positions.target} className="v2-architecture-handle" />
            <div className="v2-architecture-node-icon" style={{ color: style.accent, borderColor: style.border, background: style.tint }}>
                <Icon size={15} strokeWidth={1.8} />
            </div>
            <div className="v2-architecture-node-copy">
                <div className="v2-architecture-node-label">{data.label}</div>
                <div className="v2-architecture-node-kind" style={{ color: style.accent }}>
                    {style.label}
                </div>
            </div>
            <Handle type="source" position={positions.source} className="v2-architecture-handle" />
        </div>
    );
});

export default ArchitectureNode;
