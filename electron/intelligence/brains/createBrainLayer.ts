// electron/intelligence/brains/createBrainLayer.ts
// Factory function that initializes the full Brain layer.
//
// Called once during app initialization. Returns a fully wired
// BrainRegistry + BrainSelector ready for use by the intelligence pipeline.
//
// Usage:
//   const { registry, selector } = createBrainLayer();
//   const brain = selector.select(analysis);
//   const output = brain.execute(input);

import { BrainRegistry } from './BrainRegistry';
import { BrainSelector } from './BrainSelector';
import { GeneralBrain } from './GeneralBrain';
import { CodingBrain } from './CodingBrain';
import { BehavioralBrain } from './BehavioralBrain';
import { SystemDesignBrain } from './SystemDesignBrain';
import { ResumeBrain } from './ResumeBrain';
import { ScreenAnalysisBrain } from './ScreenAnalysisBrain';
import { LectureBrain, LookingForWorkBrain, RecruitingBrain, SalesBrain, TeamMeetingBrain } from './ModeBrains';

export interface BrainLayer {
    registry: BrainRegistry;
    selector: BrainSelector;
}

/**
 * Create and initialize the complete Brain layer.
 *
 * Registers all domain brains and returns the registry + selector.
 * GeneralBrain is registered FIRST — it is the mandatory fallback.
 */
export function createBrainLayer(): BrainLayer {
    const registry = new BrainRegistry();

    // Register all brains — GeneralBrain first (it's the fallback)
    registry.register(new GeneralBrain());
    registry.register(new CodingBrain());
    registry.register(new BehavioralBrain());
    registry.register(new SystemDesignBrain());
    registry.register(new ResumeBrain());
    registry.register(new SalesBrain());
    registry.register(new LectureBrain());
    registry.register(new RecruitingBrain());
    registry.register(new TeamMeetingBrain());
    registry.register(new LookingForWorkBrain());
    registry.register(new ScreenAnalysisBrain());

    const selector = new BrainSelector(registry);

    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.log(registry.getSummary());
    }

    return { registry, selector };
}
