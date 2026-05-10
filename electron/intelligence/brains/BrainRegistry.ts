// electron/intelligence/brains/BrainRegistry.ts
// Registry for Brain implementations.
// Provides O(1) lookup of a Brain by its BrainId.
//
// Usage:
//   const registry = new BrainRegistry();
//   registry.register(new CodingBrain());
//   registry.register(new BehavioralBrain());
//   const brain = registry.get('coding'); // CodingBrain instance

import type { BrainId } from '../types';
import type { Brain } from './Brain';

/**
 * Registry for Brain implementations.
 *
 * Thread-safety: This registry is intended to be populated once during
 * app initialization and then read-only during request processing.
 * No locking is needed in the Electron single-threaded model.
 */
export class BrainRegistry {
    private brains = new Map<BrainId, Brain>();

    /**
     * Register a Brain implementation.
     * @throws if a brain with the same ID is already registered
     */
    register(brain: Brain): void {
        if (this.brains.has(brain.id)) {
            console.warn(`[BrainRegistry] Overwriting existing brain: ${brain.id}`);
        }
        this.brains.set(brain.id, brain);
        console.log(`[BrainRegistry] Registered brain: ${brain.id} (${brain.name})`);
    }

    /**
     * Get a Brain by its ID.
     * @returns The Brain instance, or null if not found
     */
    get(id: BrainId): Brain | null {
        return this.brains.get(id) ?? null;
    }

    /**
     * Get a Brain by its ID, throwing if not found.
     * Use this in code paths where a missing brain is a programming error.
     */
    getOrThrow(id: BrainId): Brain {
        const brain = this.brains.get(id);
        if (!brain) {
            throw new Error(`[BrainRegistry] No brain registered for id: ${id}`);
        }
        return brain;
    }

    /**
     * Check if a brain is registered for the given ID.
     */
    has(id: BrainId): boolean {
        return this.brains.has(id);
    }

    /**
     * Get all registered brain IDs.
     */
    listIds(): BrainId[] {
        return Array.from(this.brains.keys());
    }

    /**
     * Get a summary of all registered brains (for logging).
     */
    getSummary(): string {
        const entries = Array.from(this.brains.values())
            .map(b => `  ${b.id}: ${b.name} (target: ${b.latencyTarget}ms)`)
            .join('\n');
        return `[BrainRegistry] ${this.brains.size} brains registered:\n${entries}`;
    }
}
