// electron/services/context/ContextPacket.ts
// Type definitions for assembled context packets passed to the LLM pipeline.

import { TrustLevel } from './TrustLevels';

export interface EvidenceRef {
  source: string;
  text: string;
  timestamp?: number;
  fileId?: string;
  chunkId?: string;
}

export interface ContextBlock {
  type: string;
  trustLevel: TrustLevel;
  source: string;
  tokenBudget: number;
  content: string;
  recency?: number;
  evidenceRefs?: EvidenceRef[];
}

export interface ContextPacketMetadata {
  modeTemplateType?: string;
  activeModeId?: string;
  screenContextAvailable: boolean;
  tokenBudget: number;
  totalTokensUsed: number;
}

export interface ContextPacket {
  blocks: ContextBlock[];
  systemPrompt: string;
  developerPrompt?: string;
  userMessage: string;
  metadata: ContextPacketMetadata;
}
