/**
 * TamperDetector — Signed manifest verification for runtime integrity.
 *
 * Security decisions:
 * - At build time, a manifest.json is generated containing SHA-256 hashes of
 *   critical licensing files (compiled JS output).
 * - The manifest is RSA-signed using the same private key as entitlements.
 * - At runtime, the manifest signature is verified first (using the public key).
 * - Then each file's hash is checked against the manifest.
 * - If any check fails, the detector marks the runtime as TAMPERED.
 * - This is a deterrent layer — a determined attacker can patch the detector
 *   itself, but it raises the bar significantly and creates a telemetry signal.
 *
 * Manifest format (manifest.json):
 * {
 *   "files": {
 *     "licensing/EntitlementVerifier.js": "sha256-hex",
 *     "licensing/LicenseSyncManager.js": "sha256-hex"
 *   },
 *   "generatedAt": "ISO-8601",
 *   "signature": "base64url RSA-SHA256 of canonicalized files object"
 * }
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { LICENSE_PUBLIC_KEY } from './licensePublicKey';

export interface TamperManifest {
  files: Record<string, string>;
  generatedAt: string;
  signature: string;
}

export type TamperStatus = 'verified' | 'tampered' | 'unavailable';

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

export class TamperDetector {
  private static instance: TamperDetector | null = null;
  private status: TamperStatus = 'unavailable';
  private lastCheckAt: string | null = null;
  private readonly publicKey: string;
  private readonly basePath: string;
  private readonly manifestPath: string;

  constructor(options: { publicKey?: string; basePath?: string; manifestPath?: string } = {}) {
    this.publicKey = options.publicKey || LICENSE_PUBLIC_KEY;
    // In packaged app, licensing files are in the app.asar/electron/ directory
    this.basePath = options.basePath || path.join(app.getAppPath(), 'electron');
    this.manifestPath = options.manifestPath || path.join(this.basePath, 'licensing', 'tamper-manifest.json');
  }

  static getInstance(): TamperDetector {
    if (!TamperDetector.instance) {
      TamperDetector.instance = new TamperDetector();
    }
    return TamperDetector.instance;
  }

  /**
   * Verify runtime integrity against the signed manifest.
   * Returns the tamper status.
   *
   * This method is designed to be non-blocking and never throw.
   * If the manifest is missing (dev mode), returns 'unavailable'.
   */
  verify(): TamperStatus {
    try {
      // In development mode, the manifest won't exist — skip gracefully
      if (!fs.existsSync(this.manifestPath)) {
        this.status = 'unavailable';
        this.lastCheckAt = new Date().toISOString();
        return this.status;
      }

      const raw = fs.readFileSync(this.manifestPath, 'utf8');
      const manifest: TamperManifest = JSON.parse(raw);

      // Step 1: Verify manifest signature
      if (!this.verifyManifestSignature(manifest)) {
        this.status = 'tampered';
        this.lastCheckAt = new Date().toISOString();
        return this.status;
      }

      // Step 2: Verify each file hash
      for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
        const absolutePath = path.join(this.basePath, relativePath);
        if (!fs.existsSync(absolutePath)) {
          // Missing file = tampered
          this.status = 'tampered';
          this.lastCheckAt = new Date().toISOString();
          return this.status;
        }

        const content = fs.readFileSync(absolutePath);
        const actualHash = crypto.createHash('sha256').update(content).digest('hex');

        if (actualHash !== expectedHash) {
          this.status = 'tampered';
          this.lastCheckAt = new Date().toISOString();
          return this.status;
        }
      }

      this.status = 'verified';
      this.lastCheckAt = new Date().toISOString();
      return this.status;
    } catch {
      // Any error during tamper check = treat as unavailable (not tampered)
      // to avoid false positives from filesystem issues
      this.status = 'unavailable';
      this.lastCheckAt = new Date().toISOString();
      return this.status;
    }
  }

  getStatus(): TamperStatus {
    return this.status;
  }

  getLastCheckAt(): string | null {
    return this.lastCheckAt;
  }

  private verifyManifestSignature(manifest: TamperManifest): boolean {
    try {
      const { signature, files } = manifest;
      if (!signature || !files || typeof files !== 'object') return false;

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(canonicalize(files));
      verifier.end();

      return verifier.verify(this.publicKey, base64UrlToBuffer(signature));
    } catch {
      return false;
    }
  }
}
