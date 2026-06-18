// electron/services/context/index.ts
// Barrel export for the context assembly subsystem.

export { TrustLevel, TRUST_LEVEL_ORDER, containsPromptInjection, DANGEROUS_PATTERNS } from './TrustLevels';
export type { EvidenceRef, ContextBlock, ContextPacket, ContextPacketMetadata } from './ContextPacket';
export { PromptAssembler } from './PromptAssembler';
export type { ScreenContext, ModeContextInput, AssembleParams } from './PromptAssembler';
