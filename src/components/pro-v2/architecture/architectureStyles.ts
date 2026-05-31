import type { ArchitectureNodeKind } from './architectureSchema';

export interface ArchitectureKindStyle {
    accent: string;
    tint: string;
    border: string;
    label: string;
}

export const ARCHITECTURE_KIND_STYLES: Record<ArchitectureNodeKind, ArchitectureKindStyle> = {
    client: {
        accent: 'rgba(125, 211, 252, 0.86)',
        tint: 'rgba(14, 165, 233, 0.10)',
        border: 'rgba(125, 211, 252, 0.24)',
        label: 'Client',
    },
    gateway: {
        accent: 'rgba(251, 191, 36, 0.88)',
        tint: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(251, 191, 36, 0.28)',
        label: 'Gateway',
    },
    service: {
        accent: 'rgba(167, 243, 208, 0.84)',
        tint: 'rgba(16, 185, 129, 0.10)',
        border: 'rgba(167, 243, 208, 0.22)',
        label: 'Service',
    },
    database: {
        accent: 'rgba(216, 180, 254, 0.82)',
        tint: 'rgba(168, 85, 247, 0.10)',
        border: 'rgba(216, 180, 254, 0.24)',
        label: 'Database',
    },
    cache: {
        accent: 'rgba(253, 186, 116, 0.86)',
        tint: 'rgba(249, 115, 22, 0.10)',
        border: 'rgba(253, 186, 116, 0.24)',
        label: 'Cache',
    },
    queue: {
        accent: 'rgba(147, 197, 253, 0.84)',
        tint: 'rgba(59, 130, 246, 0.10)',
        border: 'rgba(147, 197, 253, 0.23)',
        label: 'Queue',
    },
    storage: {
        accent: 'rgba(203, 213, 225, 0.86)',
        tint: 'rgba(148, 163, 184, 0.10)',
        border: 'rgba(203, 213, 225, 0.22)',
        label: 'Storage',
    },
    external: {
        accent: 'rgba(244, 114, 182, 0.82)',
        tint: 'rgba(236, 72, 153, 0.10)',
        border: 'rgba(244, 114, 182, 0.22)',
        label: 'External',
    },
};

export const ARCHITECTURE_NODE_WIDTH = 212;
export const ARCHITECTURE_NODE_HEIGHT = 124;
