export type PermissionState =
  | 'granted'
  | 'denied'
  | 'not_requested'
  | 'restart_required'
  | 'unsupported';

export type PermissionKind = 'screenRecording' | 'microphone' | 'accessibility';

export type OnboardingStep = 'welcome' | 'permissions' | 'ready';

export interface PermissionStatusSnapshot {
  screenRecording: PermissionState;
  microphone: PermissionState;
  accessibility: PermissionState;
  restartRequired: boolean;
  platform: NodeJS.Platform;
  checkedAt: string;
}

export interface PermissionRequestResult {
  success: boolean;
  status: PermissionStatusSnapshot;
  prompted?: boolean;
  openedSettings?: boolean;
  message?: string;
}

export interface PermissionSettingsResult {
  success: boolean;
  message?: string;
}
