import type {
  PermissionKind,
  PermissionState,
  PermissionStatusSnapshot,
} from './types';

const isWindows = typeof navigator !== 'undefined'
  ? (navigator.platform?.toLowerCase().startsWith('win') || /win32/i.test(navigator.userAgent))
  : false;

// On Windows, only microphone requires an OS-level permission gate.
// Screen Recording and Accessibility are always available on Windows.
const REQUIRED_PERMISSIONS: PermissionKind[] = isWindows
  ? ['microphone']
  : ['screenRecording', 'microphone', 'accessibility'];

export function isPermissionGranted(state: PermissionState): boolean {
  return state === 'granted';
}

export function isPermissionStatusOperational(status: PermissionStatusSnapshot | null | undefined): boolean {
  if (!status) return false;
  if (status.restartRequired) return false;

  return REQUIRED_PERMISSIONS.every((permission) => isPermissionGranted(status[permission]));
}

export function getBlockingPermissions(status: PermissionStatusSnapshot | null | undefined): PermissionKind[] {
  if (!status) {
    return [...REQUIRED_PERMISSIONS];
  }

  return REQUIRED_PERMISSIONS.filter((permission) => !isPermissionGranted(status[permission]));
}

export function getPermissionLabel(permission: PermissionKind): string {
  switch (permission) {
    case 'screenRecording':
      return 'Screen Recording';
    case 'microphone':
      return 'Microphone';
    case 'accessibility':
      return 'Accessibility';
    default:
      return permission;
  }
}

export function formatBlockingPermissions(status: PermissionStatusSnapshot | null | undefined): string {
  const blockers = getBlockingPermissions(status).map(getPermissionLabel);
  if (blockers.length === 0) return 'none';
  if (blockers.length === 1) return blockers[0];
  if (blockers.length === 2) return `${blockers[0]} and ${blockers[1]}`;
  return `${blockers.slice(0, -1).join(', ')}, and ${blockers[blockers.length - 1]}`;
}

export function arePermissionSnapshotsEqual(
  left: PermissionStatusSnapshot | null | undefined,
  right: PermissionStatusSnapshot | null | undefined,
): boolean {
  if (!left || !right) return left === right;

  return (
    left.screenRecording === right.screenRecording &&
    left.microphone === right.microphone &&
    left.accessibility === right.accessibility &&
    left.restartRequired === right.restartRequired &&
    left.platform === right.platform
  );
}
