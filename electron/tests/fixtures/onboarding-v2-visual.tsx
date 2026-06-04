import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import { PremiumOnboardingV2 } from '../../../src/components/onboarding/PremiumOnboardingV2';
import { OnboardingV2PostLaunch } from '../../../src/components/onboarding/OnboardingV2PostLaunch';
import { usePermissionsStore } from '../../../src/stores/usePermissionsStore';
import type { PermissionStatusSnapshot } from '../../../src/lib/permissions/types';
import type {
  GoogleAuthUserWithOnboardingV2,
  OnboardingV2State,
} from '../../../src/components/onboarding/onboardingV2Types';

const params = new URLSearchParams(window.location.search);
const scenario = params.get('scenario') ?? 'new';

let permissionStatus: PermissionStatusSnapshot = {
  screenRecording: scenario === 'returning' ? 'granted' : 'not_requested',
  microphone: scenario === 'returning' ? 'granted' : 'not_requested',
  accessibility: scenario === 'returning' ? 'granted' : 'not_requested',
  restartRequired: false,
  platform: 'darwin',
  checkedAt: new Date().toISOString(),
};

let onboardingV2State: OnboardingV2State = {
  tourComplete: false,
  firstSuccess: {
    completed: false,
    action: null,
    completedAt: null,
  },
};

const completedUser: GoogleAuthUserWithOnboardingV2 = {
  id: 'visual-user',
  googleId: 'visual-google-user',
  name: 'Visual User',
  email: 'visual@example.com',
  calendarConnected: false,
  onboardingV1: {
    persona: scenario === 'developer' ? 'developer' : 'interview_preparation',
    industry: 'engineering',
    discoverySource: 'google',
    completedAt: '2026-06-04T00:00:00.000Z',
    onboardingVersion: 1,
    completedInVersion: '1.0.0',
  },
};

const newUser: GoogleAuthUserWithOnboardingV2 = {
  id: 'visual-user',
  googleId: 'visual-google-user',
  name: 'Visual User',
  email: 'visual@example.com',
  calendarConnected: false,
  onboardingV1: null,
};

function syncPermissionStore() {
  usePermissionsStore.setState({
    status: permissionStatus,
    hasInitialized: true,
    isChecking: false,
    onboardingCompleted: scenario === 'returning',
    currentStep: 'welcome',
    lastError: null,
    activePermission: null,
  });
}

function grant(kind: 'screenRecording' | 'microphone' | 'accessibility') {
  permissionStatus = {
    ...permissionStatus,
    [kind]: 'granted',
    checkedAt: new Date().toISOString(),
  };
  return { success: true, status: permissionStatus, message: 'Granted' };
}

window.electronAPI = {
  ...(window.electronAPI as any),
  permissions: {
    getStatus: async () => permissionStatus,
    requestScreenRecording: async () => grant('screenRecording'),
    requestMicrophone: async () => grant('microphone'),
    requestAccessibility: async () => grant('accessibility'),
    openSettings: async () => ({ success: true }),
    onStatusChanged: () => () => {},
  },
  quitApp: async () => {},
  googleVerifySession: async () => (
    scenario === 'returning'
      ? {
        success: true,
        user: completedUser,
        authState: { authenticated: true, user: completedUser, calendarConnected: false },
      }
      : {
        success: false,
        error: 'Not authenticated',
        authState: { authenticated: false, user: null, calendarConnected: false },
      }
  ),
  googleSignIn: async () => ({
    success: true,
    user: newUser,
    authState: { authenticated: true, user: newUser, calendarConnected: false },
  }),
  googleSaveOnboardingV1: async (data: any) => ({
    success: true,
    user: {
      ...completedUser,
      onboardingV1: {
        persona: data.persona,
        industry: data.industry,
        discoverySource: data.discoverySource,
        completedAt: '2026-06-04T00:00:00.000Z',
        onboardingVersion: 1,
        completedInVersion: '1.0.0',
      },
    },
    authState: { authenticated: true, user: completedUser, calendarConnected: false },
  }),
  onboardingV2GetState: async () => {
    document.body.dataset.onboardingV2OptionalStateRequested = String(performance.now());
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    document.body.dataset.onboardingV2OptionalStateResolved = String(performance.now());
    return { success: true, state: onboardingV2State };
  },
  onboardingV2UpdateState: async (_email: string, patch: any) => {
    onboardingV2State = {
      ...onboardingV2State,
      ...patch,
      firstSuccess: {
        ...onboardingV2State.firstSuccess,
        ...(patch.firstSuccess ?? {}),
      },
    };
    return { success: true, state: onboardingV2State };
  },
  profileSelectFile: async () => ({ success: true, fileToken: 'visual-file', fileName: 'visual.pdf' }),
  profileUploadResume: async () => ({ success: true }),
  profileUploadJD: async () => ({ success: true }),
  googleConnectCalendar: async () => ({
    success: true,
    user: { ...completedUser, calendarConnected: true },
    authState: { authenticated: true, user: { ...completedUser, calendarConnected: true }, calendarConnected: true },
  }),
  modesGetAll: async () => [],
  modesCreate: async () => ({ success: true, mode: { id: 'mode-technical', templateType: 'technical-interview' } }),
  modesSetActive: async () => ({ success: true }),
  modesSetSelected: async () => ({ success: true }),
  setSessionMode: async (mode: any) => ({ success: true, mode }),
} as any;

function WorkspaceHarness({
  user,
  onAuthUserChange,
}: {
  user: GoogleAuthUserWithOnboardingV2 | null;
  onAuthUserChange: (user: GoogleAuthUserWithOnboardingV2) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<string | null>(null);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#101116] text-white">
      <header className="flex h-12 items-center justify-between border-b border-white/10 bg-white/[0.04] px-5">
        <div data-tour-id="control-center" className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold">
          Control Center
        </div>
        <div className="flex items-center gap-2">
          <button data-tour-id="interview-mode" className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold">
            Interview Mode
          </button>
          <button data-tour-id="settings" className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold">
            Settings
          </button>
        </div>
      </header>
      <main className="grid h-[calc(100vh-48px)] place-items-center">
        <button data-tour-id="overlay-control" className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black">
          Start TeamSync
        </button>
      </main>
      {settingsTab ? (
        <section className="absolute right-5 top-16 w-[360px] rounded-2xl border border-white/10 bg-[#08090d]/95 p-5 shadow-2xl">
          {settingsTab === 'profile' ? (
            <div data-tour-id="profile-intelligence" className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <p className="text-sm font-semibold">Profile Intelligence</p>
              <p className="mt-1 text-xs text-white/50">Resume, JD, and role context.</p>
            </div>
          ) : null}
          {settingsTab === 'audio' ? (
            <div data-tour-id="settings-audio-provider" className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <p className="text-sm font-semibold">Audio Engine</p>
              <p className="mt-1 text-xs text-white/50">Speech provider and transcription input.</p>
            </div>
          ) : null}
          {settingsTab === 'calendar' ? (
            <div data-tour-id="settings-calendar-sync" className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <p className="text-sm font-semibold">Calendar Context</p>
              <p className="mt-1 text-xs text-white/50">Meeting-aware agenda and attendee context.</p>
            </div>
          ) : null}
          {settingsTab === 'ai-providers' ? (
            <div data-tour-id="settings-ai-providers" className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <p className="text-sm font-semibold">AI Providers</p>
              <p className="mt-1 text-xs text-white/50">Provider routing and model configuration.</p>
            </div>
          ) : null}
        </section>
      ) : null}
      <OnboardingV2PostLaunch
        isEnabled
        user={user}
        onOpenSettings={(tab) => setSettingsTab(tab ?? 'overview')}
        onCloseSettings={() => setSettingsTab(null)}
        onStartMeeting={() => true}
        onAuthUserChange={onAuthUserChange}
      />
    </div>
  );
}

function Fixture() {
  const [launched, setLaunched] = useState(false);
  const [user, setUser] = useState<GoogleAuthUserWithOnboardingV2 | null>(scenario === 'returning' ? completedUser : null);

  useEffect(() => {
    syncPermissionStore();
  }, []);

  if (launched) {
    return <WorkspaceHarness user={user} onAuthUserChange={setUser} />;
  }

  return (
    <PremiumOnboardingV2
      isOpen
      initialUser={user}
      skipIntroScreens={scenario === 'returning'}
      startAtPermissions={false}
      onAuthUserChange={setUser}
      onLaunch={(updatedUser) => {
        setUser(updatedUser);
        setLaunched(true);
        document.body.dataset.workspaceLaunched = 'true';
        document.body.dataset.workspaceLaunchAt = String(performance.now());
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
