/**
 * Premium ModesSettings — re-exports the real ModesSettings component
 * with prop mapping so the premium loader can resolve it.
 */
import React from 'react';
import ModesSettings from '../../src/components/settings/ModesSettings';

interface PremiumModesSettingsProps {
  onClose: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onOpenNativelyAPI?: () => void;
}

const PremiumModesSettings: React.FC<PremiumModesSettingsProps> = ({
  onOpenNativelyAPI,
  ...rest
}) => {
  return <ModesSettings {...rest} onOpenTeamSyncAPI={onOpenNativelyAPI} />;
};

export default PremiumModesSettings;
