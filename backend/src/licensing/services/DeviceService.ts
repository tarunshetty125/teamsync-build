import os from 'os';
import { getDevicesCollection } from '../../db/mongodb';
import type { LicenseDocument } from '../models/License';
import type { DeviceDocument } from '../models/Device';

export class DeviceLimitError extends Error {
  constructor(message = 'Device limit exceeded.') {
    super(message);
    this.name = 'DeviceLimitError';
  }
}

export class DeviceRevokedError extends Error {
  constructor(message = 'Device has been removed or revoked.') {
    super(message);
    this.name = 'DeviceRevokedError';
  }
}

export class DeviceService {
  async registerOrTouchDevice(params: {
    license: LicenseDocument;
    deviceId: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
  }): Promise<DeviceDocument> {
    const devices = getDevicesCollection();
    const now = new Date();
    const deviceName = sanitizeDeviceName(params.deviceName);
    const platform = sanitizePlatform(params.platform);

    const existing = await devices.findOne({
      licenseId: params.license.licenseId,
      deviceId: params.deviceId,
    });

    if (existing) {
      if (existing.status === 'revoked') {
        throw new DeviceRevokedError();
      }

      if (existing.status === 'removed') {
        const activeDeviceCount = await devices.countDocuments({
          licenseId: params.license.licenseId,
          status: 'active',
        });

        if (activeDeviceCount >= params.license.deviceLimit) {
          throw new DeviceLimitError();
        }
      }

      await devices.updateOne(
        { licenseId: params.license.licenseId, deviceId: params.deviceId },
        {
          $set: {
            deviceName,
            platform,
            appVersion: params.appVersion,
            status: 'active',
            lastSeenAt: now,
            updatedAt: now,
          },
        }
      );
      return {
        ...existing,
        deviceName,
        platform,
        appVersion: params.appVersion,
        status: 'active',
        lastSeenAt: now,
        updatedAt: now,
      };
    }

    const activeDeviceCount = await devices.countDocuments({
      licenseId: params.license.licenseId,
      status: 'active',
    });

    if (activeDeviceCount >= params.license.deviceLimit) {
      throw new DeviceLimitError();
    }

    const device: DeviceDocument = {
      deviceId: params.deviceId,
      licenseId: params.license.licenseId,
      deviceName,
      platform,
      appVersion: params.appVersion,
      status: 'active',
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await devices.insertOne(device);
    return device;
  }

  async getActiveDevice(licenseId: string, deviceId: string): Promise<DeviceDocument | null> {
    return getDevicesCollection().findOne({
      licenseId,
      deviceId,
      status: 'active',
    });
  }

  async markRemoved(licenseId: string, deviceId: string): Promise<void> {
    await getDevicesCollection().updateOne(
      { licenseId, deviceId },
      { $set: { status: 'removed', updatedAt: new Date() } }
    );
  }

  async touch(licenseId: string, deviceId: string): Promise<void> {
    await getDevicesCollection().updateOne(
      { licenseId, deviceId, status: 'active' },
      { $set: { lastSeenAt: new Date(), updatedAt: new Date() } }
    );
  }
}

function sanitizeDeviceName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : os.hostname().slice(0, 80);
}

function sanitizePlatform(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 40) : 'unknown';
}
