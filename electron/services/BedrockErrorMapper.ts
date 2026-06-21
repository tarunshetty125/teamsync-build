/**
 * BedrockErrorMapper — Structured AWS exception mapping.
 *
 * Maps raw AWS SDK exceptions into user-friendly error objects
 * with retry guidance, re-authentication signals, and actionable messages.
 *
 * Replaces the generic `BedrockClient.normalizeError()` string concatenation
 * with typed error objects that the UI and fallback logic can act on.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface BedrockMappedError {
    /** User-facing error message (suitable for display in the UI) */
    userMessage: string;
    /** Whether the error is transient and the request should be retried */
    isRetryable: boolean;
    /** Suggested delay before retry, in milliseconds */
    retryAfterMs?: number;
    /** Whether this error indicates expired/invalid credentials */
    requiresReauth: boolean;
    /** Original AWS exception name (for logging/telemetry) */
    awsExceptionName: string;
    /** HTTP status code, if available */
    httpStatus?: number;
    /** Original error message (for developer debugging — never show to user) */
    rawMessage: string;
}

// ─── Expired Token Detection ──────────────────────────────────────────────

const EXPIRED_TOKEN_SIGNALS = [
    'expiredtoken',
    'expired token',
    'token has expired',
    'credentials expired',
    'session expired',
    'sso session',
    'security token included in the request is expired',
    'security token included in the request is invalid',
    'invalidclienttoken',
    'unrecognizedclient',
];

function isExpiredTokenError(name: string, message: string): boolean {
    const combined = `${name} ${message}`.toLowerCase();
    return EXPIRED_TOKEN_SIGNALS.some(signal => combined.includes(signal));
}

// ─── Network Error Detection ──────────────────────────────────────────────

function isNetworkError(error: any): boolean {
    const code = error?.code || error?.errno || '';
    return ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ERR_NETWORK'].includes(code)
        || error?.message?.includes?.('fetch failed')
        || error?.message?.includes?.('network');
}

// ─── Mapper ───────────────────────────────────────────────────────────────

/**
 * Map a raw AWS SDK error into a structured, actionable error object.
 *
 * Usage:
 *   try { ... } catch (err) {
 *     const mapped = mapBedrockError(err);
 *     if (mapped.requiresReauth) notifyReauth();
 *     if (mapped.isRetryable) scheduleRetry(mapped.retryAfterMs);
 *     showUserError(mapped.userMessage);
 *   }
 */
export function mapBedrockError(error: any): BedrockMappedError {
    const name = error?.name || error?.Code || error?.code || 'UnknownError';
    const message = error?.message || error?.Message || 'An unknown error occurred';
    const httpStatus: number | undefined = error?.$metadata?.httpStatusCode;

    // ── Credential / Auth Errors ──────────────────────────────────────

    if (isExpiredTokenError(name, message)) {
        return {
            userMessage: 'AWS session expired. Re-authenticate your AWS credentials in Settings.',
            isRetryable: false,
            requiresReauth: true,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    if (name === 'AccessDeniedException' || (httpStatus === 403 && !isExpiredTokenError(name, message))) {
        return {
            userMessage: 'Your AWS account does not have permission to use this model. Enable it in the Bedrock console → Model Access.',
            isRetryable: false,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    // ── Model / Resource Errors ───────────────────────────────────────

    if (name === 'ResourceNotFoundException' || httpStatus === 404) {
        return {
            userMessage: 'Model not available in this region. Try a different region or enable model access in the Bedrock console.',
            isRetryable: false,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    if (name === 'ValidationException' || httpStatus === 400) {
        // Check for specific validation issues
        const lower = message.toLowerCase();
        if (lower.includes('too many tokens') || lower.includes('maximum') || lower.includes('exceeds')) {
            return {
                userMessage: 'The prompt is too long for this model. Try shortening your message or using a model with a larger context window.',
                isRetryable: false,
                requiresReauth: false,
                awsExceptionName: name,
                httpStatus,
                rawMessage: message,
            };
        }
        return {
            userMessage: 'Invalid request. Please check your model selection and try again.',
            isRetryable: false,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    // ── Throttling / Rate Limits ──────────────────────────────────────

    if (name === 'ThrottlingException' || name === 'TooManyRequestsException' || httpStatus === 429) {
        return {
            userMessage: 'AWS rate limit reached. Retrying automatically…',
            isRetryable: true,
            retryAfterMs: 2000,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    if (name === 'ServiceQuotaExceededException') {
        return {
            userMessage: 'AWS service quota exceeded. Request a limit increase in the AWS Service Quotas console.',
            isRetryable: false,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    if (name === 'ModelNotReadyException') {
        return {
            userMessage: 'Model is still initializing. Try again in a few seconds.',
            isRetryable: true,
            retryAfterMs: 5000,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    // ── Timeout / Stream Errors ───────────────────────────────────────

    if (name === 'ModelTimeoutException' || httpStatus === 408) {
        return {
            userMessage: 'Model timed out. Try a shorter prompt or a faster model.',
            isRetryable: true,
            retryAfterMs: 1000,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    if (name === 'ModelStreamErrorException') {
        return {
            userMessage: 'Stream interrupted. Retrying…',
            isRetryable: true,
            retryAfterMs: 500,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    if (name === 'ModelErrorException' || (httpStatus && httpStatus >= 500)) {
        return {
            userMessage: 'Bedrock service error. AWS is experiencing issues. Try again shortly.',
            isRetryable: true,
            retryAfterMs: 3000,
            requiresReauth: false,
            awsExceptionName: name,
            httpStatus,
            rawMessage: message,
        };
    }

    // ── Network Errors ────────────────────────────────────────────────

    if (isNetworkError(error)) {
        const code = error?.code || error?.errno || 'NETWORK';
        if (code === 'ENOTFOUND') {
            return {
                userMessage: 'Cannot reach AWS. Check your internet connection and verify the configured region is valid.',
                isRetryable: true,
                retryAfterMs: 5000,
                requiresReauth: false,
                awsExceptionName: code,
                httpStatus,
                rawMessage: message,
            };
        }
        return {
            userMessage: 'Network connection lost. Retrying…',
            isRetryable: true,
            retryAfterMs: 2000,
            requiresReauth: false,
            awsExceptionName: code,
            httpStatus,
            rawMessage: message,
        };
    }

    // ── Abort / Cancellation ──────────────────────────────────────────

    if (name === 'AbortError' || error?.name === 'AbortError') {
        return {
            userMessage: 'Request was cancelled.',
            isRetryable: false,
            requiresReauth: false,
            awsExceptionName: 'AbortError',
            httpStatus,
            rawMessage: message,
        };
    }

    // ── Unknown / Default ─────────────────────────────────────────────

    return {
        userMessage: `Bedrock request failed: ${name}`,
        isRetryable: false,
        requiresReauth: false,
        awsExceptionName: name,
        httpStatus,
        rawMessage: message,
    };
}

/**
 * Format a BedrockMappedError into a user-facing string.
 * Backward-compatible replacement for BedrockClient.normalizeError().
 */
export function formatBedrockError(error: any): string {
    const mapped = mapBedrockError(error);
    return mapped.userMessage;
}

/**
 * Check if a raw error indicates Bedrock credentials need re-authentication.
 * Backward-compatible replacement for the standalone isBedrockReauthenticationError().
 */
export function isBedrockReauthError(error: any): boolean {
    return mapBedrockError(error).requiresReauth;
}
