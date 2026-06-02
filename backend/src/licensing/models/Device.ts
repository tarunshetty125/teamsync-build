export type DeviceStatus = 'active' | 'removed' | 'revoked';

export interface DeviceDocument {
  deviceId: string;
  deviceName: string;
  platform?: string;
  appVersion?: string;
  lastSeenAt: Date;
  licenseId: string;
  status: DeviceStatus;
  createdAt: Date;
  updatedAt: Date;
}
