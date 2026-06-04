import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import {
  ReferenceOnboardingModal,
  type GoogleAuthUserWithOnboarding,
} from '../../../src/components/onboarding/ReferenceOnboardingModal';

const completedUser: GoogleAuthUserWithOnboarding = {
  id: 'visual-user',
  googleId: 'visual-google-user',
  name: 'Visual User',
  email: 'visual@example.com',
  calendarConnected: false,
  onboardingV1: {
    persona: 'interview_preparation',
    industry: 'engineering',
    discoverySource: 'google',
    completedAt: '2026-06-04T00:00:00.000Z',
    onboardingVersion: 1,
    completedInVersion: '1.0.0',
  },
};

window.electronAPI = {
  ...(window.electronAPI as any),
  googleSaveOnboardingV1: async () => ({
    success: true,
    user: completedUser as any,
    authState: {
      authenticated: true,
      user: completedUser as any,
      calendarConnected: false,
    },
  }),
} as any;

function Fixture() {
  return (
    <ReferenceOnboardingModal
      isOpen
      user={{
        id: 'visual-user',
        googleId: 'visual-google-user',
        name: 'Visual User',
        email: 'visual@example.com',
        calendarConnected: false,
        onboardingV1: null,
      }}
      onComplete={() => {
        document.body.dataset.onboardingComplete = 'true';
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
