// electron/intelligence/timeline/SignalEmitter.ts
// Safe wrapper for emitting intelligence signals.
//
// Validates signal shape, generates unique IDs, and routes
// through the IntelligenceEventBus. Capability-gated: if the
// 'timeline' capability is disabled, all emissions are silently skipped.
//
// Usage:
//   const signal = emitSignal({ type: 'buying_signal', label: 'Budget mentioned', confidence: 0.8 });

import type { IntelligenceSignal, SignalSeverity, SignalType } from './types';
import { IntelligenceEventBus } from './IntelligenceEventBus';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Signal Emission
// ---------------------------------------------------------------------------

/**
 * Emit an intelligence signal through the event bus.
 *
 * Returns the signal if emitted, null if:
 *   - Timeline capability is disabled
 *   - Signal is invalid
 *   - Signal was deduplicated by the event bus
 */
export function emitSignal(params: {
    readonly type: SignalType;
    readonly label: string;
    readonly confidence: number;
    readonly severity?: SignalSeverity;
    readonly modeId?: string;
    readonly metadata?: Record<string, unknown>;
}): IntelligenceSignal | null {
    // Capability gate
    if (!CapabilityRegistry.getInstance().isEnabled('timeline')) {
        return null;
    }

    // Validate
    if (!params.label?.trim()) {
        return null;
    }

    const confidence = Math.max(0, Math.min(1, params.confidence));

    const signal: IntelligenceSignal = {
        id: generateSignalId(),
        type: params.type,
        label: params.label.trim(),
        confidence,
        timestamp: Date.now(),
        severity: params.severity ?? 'info',
        modeId: params.modeId,
        metadata: params.metadata,
    };

    const emitted = IntelligenceEventBus.getInstance().emit(signal);
    return emitted ? signal : null;
}

/**
 * Convenience wrapper for mode prediction signals.
 */
export function emitModePrediction(params: {
    readonly predictedMode: string;
    readonly currentMode: string;
    readonly confidence: number;
}): IntelligenceSignal | null {
    return emitSignal({
        type: 'mode_prediction',
        label: `Predicted: ${params.predictedMode} (current: ${params.currentMode})`,
        confidence: params.confidence,
        severity: 'info',
        metadata: {
            predictedMode: params.predictedMode,
            currentMode: params.currentMode,
        },
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSignalId(): string {
    return `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
