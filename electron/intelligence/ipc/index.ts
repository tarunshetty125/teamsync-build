// electron/intelligence/ipc/index.ts
// Barrel export for intelligence IPC surface layer (Phase 4).

export { AdaptiveModeIPC } from './AdaptiveModeIPC';
export { TimelineIPC } from './TimelineIPC';
export { ExplainabilityIPC } from './ExplainabilityIPC';
export { buildPremiumUXMetadata } from './PremiumUXMetadata';
export type {
    AdaptiveModeSuggestionPayload,
    TimelineBatchPayload,
    TimelineSignalPayload,
    ExplanationPayload,
    PremiumUXMetadata,
} from './types';
