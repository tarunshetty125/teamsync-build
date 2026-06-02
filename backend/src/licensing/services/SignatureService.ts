import crypto from 'crypto';
import { getBackendConfig } from '../../config/env';
import type { EntitlementPayload } from '../models/Entitlement';

type UnsignedEntitlementPayload = Omit<EntitlementPayload, 'signature'>;

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

export class SignatureService {
  private readonly privateKey: string;

  constructor(privateKey = getBackendConfig().licensePrivateKey) {
    this.privateKey = privateKey;
  }

  sign(payload: UnsignedEntitlementPayload): string {
    if (!this.privateKey) {
      throw new Error('LICENSE_PRIVATE_KEY is required to sign entitlements.');
    }
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalize(payload));
    signer.end();
    return base64Url(signer.sign(this.privateKey));
  }

  attachSignature(payload: UnsignedEntitlementPayload): EntitlementPayload {
    return {
      ...payload,
      signature: this.sign(payload),
    };
  }
}
