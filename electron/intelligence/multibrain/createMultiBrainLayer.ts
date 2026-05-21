// electron/intelligence/multibrain/createMultiBrainLayer.ts
// Factory that creates and registers all sub-brains for each mode.
//
// Called once during initialization. Returns a populated SubBrainRegistry.

import { SubBrainRegistry } from './SubBrainRegistry';

// Recruiting sub-brains
import { OwnershipBrain } from './sub-brains/recruiting/OwnershipBrain';
import { STARBrain } from './sub-brains/recruiting/STARBrain';
import { ImpactBrain } from './sub-brains/recruiting/ImpactBrain';
import { RedFlagBrain } from './sub-brains/recruiting/RedFlagBrain';
import { CommunicationBrain } from './sub-brains/recruiting/CommunicationBrain';

// Sales sub-brains
import { ObjectionBrain } from './sub-brains/sales/ObjectionBrain';
import { BuyingSignalBrain } from './sub-brains/sales/BuyingSignalBrain';
import { PricingPressureBrain } from './sub-brains/sales/PricingPressureBrain';
import { UrgencyBrain } from './sub-brains/sales/UrgencyBrain';
import { CompetitorBrain } from './sub-brains/sales/CompetitorBrain';

// Team Meeting sub-brains (Phase 5A)
import { DecisionBrain } from './sub-brains/team-meeting/DecisionBrain';
import { OwnerBrain } from './sub-brains/team-meeting/OwnerBrain';
import { BlockerBrain } from './sub-brains/team-meeting/BlockerBrain';
import { DeadlineBrain } from './sub-brains/team-meeting/DeadlineBrain';
import { ActionItemBrain } from './sub-brains/team-meeting/ActionItemBrain';

// Technical Interview sub-brains (Phase 5B)
import { CorrectnessBrain } from './sub-brains/technical-interview/CorrectnessBrain';
import { TechnicalDepthBrain } from './sub-brains/technical-interview/TechnicalDepthBrain';
import { InterviewConfidenceBrain } from './sub-brains/technical-interview/InterviewConfidenceBrain';
import { SystemDesignSubBrain } from './sub-brains/technical-interview/SystemDesignSubBrain';
import { InterviewCommunicationBrain } from './sub-brains/technical-interview/InterviewCommunicationBrain';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully populated SubBrainRegistry with all sub-brains.
 *
 * Phase 2 scope: Recruiting + Sales
 * Phase 5A scope: Team Meeting
 * Phase 5B scope: Technical Interview
 */
export function createSubBrainRegistry(): SubBrainRegistry {
    const registry = new SubBrainRegistry();

    // Recruiting sub-brains
    registry.register('recruiting', new OwnershipBrain());
    registry.register('recruiting', new STARBrain());
    registry.register('recruiting', new ImpactBrain());
    registry.register('recruiting', new RedFlagBrain());
    registry.register('recruiting', new CommunicationBrain());

    // Sales sub-brains
    registry.register('sales', new ObjectionBrain());
    registry.register('sales', new BuyingSignalBrain());
    registry.register('sales', new PricingPressureBrain());
    registry.register('sales', new UrgencyBrain());
    registry.register('sales', new CompetitorBrain());

    // Team Meeting sub-brains (Phase 5A)
    registry.register('team_meeting', new DecisionBrain());
    registry.register('team_meeting', new OwnerBrain());
    registry.register('team_meeting', new BlockerBrain());
    registry.register('team_meeting', new DeadlineBrain());
    registry.register('team_meeting', new ActionItemBrain());

    // Technical Interview sub-brains (Phase 5B)
    // Shared across CodingBrain, BehavioralBrain, SystemDesignBrain
    registry.register('technical_interview', new CorrectnessBrain());
    registry.register('technical_interview', new TechnicalDepthBrain());
    registry.register('technical_interview', new InterviewConfidenceBrain());
    registry.register('technical_interview', new SystemDesignSubBrain());
    registry.register('technical_interview', new InterviewCommunicationBrain());

    return registry;
}
