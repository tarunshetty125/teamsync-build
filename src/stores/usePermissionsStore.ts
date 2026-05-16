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
  onboardingCompleted: boolean;
  currentStep: OnboardingStep;
  lastError: string | null;
  activePermission: PermissionKind | null;
  initialize: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  requestPermission: (permission: PermissionKind) => Promise<void>;
  openSettings: (permission: PermissionKind) => Promise<void>;
  setCurrentStep: (step: OnboardingStep) => void;
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
            lastError: 'Permissions bridge is unavailable.',
          });
          return;
        }

        set({ isChecking: true });

        try {
          const status = await window.electronAPI.permissions.getStatus();
          set((state) => ({
            status,
            isChecking: false,
            lastError: null,
            currentStep: deriveStep(state.currentStep, state.onboardingCompleted, status),
          }));
        } catch (error) {
          set({
            isChecking: false,
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

        try {
          const requesters = {
            screenRecording: window.electronAPI.permissions.requestScreenRecording,
            microphone: window.electronAPI.permissions.requestMicrophone,
            accessibility: window.electronAPI.permissions.requestAccessibility,
          } as const;

          const result = await requesters[permission]();
          set((state) => ({
            status: result.status,
            isChecking: false,
            activePermission: null,
            lastError: result.success ? null : result.message ?? null,
            currentStep: deriveStep(
              state.currentStep === 'welcome' ? 'permissions' : state.currentStep,
              state.onboardingCompleted,
              result.status,
            ),
          }));
        } catch (error) {
          set({
            isChecking: false,
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
