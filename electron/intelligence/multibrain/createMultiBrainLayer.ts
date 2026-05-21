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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully populated SubBrainRegistry with all v1 sub-brains.
 *
 * Phase 2 scope: Recruiting + Sales only.
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

    return registry;
}
