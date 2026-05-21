// electron/intelligence/multibrain/SubBrainRegistry.ts
// Mode-based sub-brain registration and lookup.
//
// Not a singleton — instantiated per brain layer for testability.
//
// Usage:
//   const registry = new SubBrainRegistry();
//   registry.register('recruiting', new OwnershipBrain());
//   const brains = registry.getBrains('recruiting'); // → [OwnershipBrain]

import type { SubBrain } from './types';

// ---------------------------------------------------------------------------
// SubBrainRegistry
// ---------------------------------------------------------------------------

export class SubBrainRegistry {
    private readonly brainsByMode: Map<string, SubBrain[]> = new Map();

    /**
     * Register a sub-brain for a specific mode.
     * Multiple sub-brains can be registered per mode.
     * Duplicate IDs within the same mode are silently ignored.
     */
    register(modeId: string, brain: SubBrain): void {
        if (!this.brainsByMode.has(modeId)) {
            this.brainsByMode.set(modeId, []);
        }

        const existing = this.brainsByMode.get(modeId)!;

        // Prevent duplicate registration
        if (existing.some(b => b.id === brain.id)) {
            return;
        }

        existing.push(brain);
    }

    /**
     * Get all sub-brains registered for a mode.
     * Returns empty array if none registered.
     */
    getBrains(modeId: string): readonly SubBrain[] {
        return this.brainsByMode.get(modeId) ?? [];
    }

    /**
     * Check if any sub-brains are registered for a mode.
     */
    hasBrains(modeId: string): boolean {
        const brains = this.brainsByMode.get(modeId);
        return brains !== undefined && brains.length > 0;
    }

    /**
     * Get the total count of registered sub-brains across all modes.
     */
    getCount(): number {
        let count = 0;
        for (const brains of this.brainsByMode.values()) {
            count += brains.length;
        }
        return count;
    }

    /**
     * Get all registered mode IDs.
     */
    getModes(): string[] {
        return Array.from(this.brainsByMode.keys());
    }
}
