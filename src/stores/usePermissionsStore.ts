import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  OnboardingStep,
  PermissionKind,
  PermissionStatusSnapshot,
} from '../lib/permissions/types';
import { isPermissionStatusOperational } from '../lib/permissions/utils';

interface PermissionsStoreState {
  status: PermissionStatusSnapshot | null;
  isChecking: boolean;
  hasInitialized: boolean;
  onboardingCompleted: boolean;
  currentStep: OnboardingStep;
  lastError: string | null;
  activePermission: PermissionKind | null;
  initialize: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  requestPermission: (permission: PermissionKind) => Promise<void>;
  openSettings: (permission: PermissionKind) => Promise<void>;
  setCurrentStep: (step: OnboardingStep) => void;
  setLastError: (message: string | null) => void;
  completeOnboarding: () => void;
}

const STORAGE_KEY = 'teamsync-permissions-onboarding-v1';

let statusSubscriptionCleanup: (() => void) | null = null;

function deriveStep(
  currentStep: OnboardingStep,
  onboardingCompleted: boolean,
  status: PermissionStatusSnapshot | null,
): OnboardingStep {
  if (!status) {
    return onboardingCompleted ? 'permissions' : currentStep;
  }

  if (isPermissionStatusOperational(status)) {
    if (!onboardingCompleted && currentStep === 'welcome') {
      return 'welcome';
    }

    return 'ready';
  }

  if (onboardingCompleted) {
    return 'permissions';
  }

  return currentStep === 'welcome' ? 'welcome' : 'permissions';
}

export const usePermissionsStore = create<PermissionsStoreState>()(
  persist(
    (set, get) => ({
      status: null,
      isChecking: false,
      hasInitialized: false,
      onboardingCompleted: false,
      currentStep: 'welcome',
      lastError: null,
      activePermission: null,

      initialize: async () => {
        if (!statusSubscriptionCleanup && window.electronAPI?.permissions?.onStatusChanged) {
          statusSubscriptionCleanup = window.electronAPI.permissions.onStatusChanged((status) => {
            set((state) => ({
              status,
              isChecking: false,
              hasInitialized: true,
              currentStep: deriveStep(state.currentStep, state.onboardingCompleted, status),
            }));
          });
        }

        set((state) => ({
          isChecking: true,
          currentStep: deriveStep(state.currentStep, state.onboardingCompleted, state.status),
        }));

        await get().refreshPermissions();
      },

      refreshPermissions: async () => {
        if (!window.electronAPI?.permissions?.getStatus) {
          set({
            isChecking: false,
            hasInitialized: true,
            lastError: 'Permissions bridge is unavailable.',
          });
          return;
        }

        set({ isChecking: true });
        const minDelay = new Promise((r) => setTimeout(r, 500));

        try {
          const [status] = await Promise.all([
            window.electronAPI.permissions.getStatus(),
            minDelay,
          ]);
          set((state) => ({
            status,
            isChecking: false,
            hasInitialized: true,
            lastError: null,
            currentStep: deriveStep(state.currentStep, state.onboardingCompleted, status),
          }));
        } catch (error) {
          await minDelay;
          set({
            isChecking: false,
            hasInitialized: true,
            lastError: error instanceof Error ? error.message : 'Unable to refresh permissions.',
          });
        }
      },

      requestPermission: async (permission) => {
        if (!window.electronAPI?.permissions) {
          set({ lastError: 'Permissions bridge is unavailable.' });
          return;
        }

        set({
          activePermission: permission,
          isChecking: true,
          lastError: null,
        });

        const minDelay = new Promise((r) => setTimeout(r, 500));

        try {
          const requesters = {
            screenRecording: window.electronAPI.permissions.requestScreenRecording,
            microphone: window.electronAPI.permissions.requestMicrophone,
            accessibility: window.electronAPI.permissions.requestAccessibility,
          } as const;

          const [result] = await Promise.all([
            requesters[permission](),
            minDelay,
          ]);
          set((state) => ({
            status: result.status,
            isChecking: false,
            hasInitialized: true,
            activePermission: null,
            lastError: result.success ? null : result.message ?? null,
            currentStep: deriveStep(
              state.currentStep === 'welcome' ? 'permissions' : state.currentStep,
              state.onboardingCompleted,
              result.status,
            ),
          }));
        } catch (error) {
          await minDelay;
          set({
            isChecking: false,
            hasInitialized: true,
            activePermission: null,
            lastError: error instanceof Error ? error.message : 'Unable to request permission.',
          });
        }
      },

      openSettings: async (permission) => {
        if (!window.electronAPI?.permissions?.openSettings) {
          set({ lastError: 'Permissions bridge is unavailable.' });
          return;
        }

        try {
          const result = await window.electronAPI.permissions.openSettings(permission);
          if (!result.success) {
            set({ lastError: result.message ?? 'Unable to open system settings.' });
          } else {
            set({ lastError: null });
          }
        } catch (error) {
          set({
            lastError: error instanceof Error ? error.message : 'Unable to open system settings.',
          });
        }
      },

      setCurrentStep: (step) => {
        set({ currentStep: step, lastError: null });
      },

      setLastError: (message) => {
        set({ lastError: message });
      },

      completeOnboarding: () => {
        set({
          onboardingCompleted: true,
          currentStep: 'ready',
          lastError: null,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
      }),
    },
  ),
);
