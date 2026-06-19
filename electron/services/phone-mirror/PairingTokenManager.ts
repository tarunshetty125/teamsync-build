/**
 * PairingTokenManager.ts
 * Generates, validates, and persists pairing tokens for Phone Mirror.
 * Uses crypto.randomBytes for secure token generation and
 * crypto.timingSafeEqual for constant-time comparison.
 */

import crypto from 'crypto';

const TOKEN_BYTE_LENGTH = 32; // 32 bytes → 64 hex chars

export class PairingTokenManager {
    private currentToken: string | null = null;

    constructor(persistedToken?: string) {
        if (persistedToken && typeof persistedToken === 'string' && persistedToken.length === TOKEN_BYTE_LENGTH * 2) {
            this.currentToken = persistedToken;
        }
    }

    /**
     * Generate a new 64-character hex token.
     * If a token already exists, this is a no-op. Use regenerateToken() to force.
     */
    generateToken(): string {
        if (!this.currentToken) {
            this.currentToken = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
        }
        return this.currentToken;
    }

    /**
     * Force-generate a new token regardless of existing one.
     */
    regenerateToken(): string {
        this.currentToken = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
        return this.currentToken;
    }

    /**
     * Validate a candidate token against the current token.
     * Uses constant-time comparison to prevent timing attacks.
     */
    validateToken(candidate: string): boolean {
        if (!this.currentToken || !candidate) return false;
        if (candidate.length !== this.currentToken.length) return false;

        try {
            const candidateBuffer = Buffer.from(candidate, 'utf-8');
            const currentBuffer = Buffer.from(this.currentToken, 'utf-8');
            return crypto.timingSafeEqual(candidateBuffer, currentBuffer);
        } catch {
            return false;
        }
    }

    /**
     * Get the current token (may be null if never generated).
     */
    getToken(): string | null {
        return this.currentToken;
    }

    /**
     * Clear the current token.
     */
    clearToken(): void {
        this.currentToken = null;
    }
}
