/** Drop IPC payloads from a previous meeting session (V1/V2 shared guard). */
export function isStaleSessionPayload(
    payloadSessionId: string | undefined,
    activeSessionId: string | null,
): boolean {
    return Boolean(
        payloadSessionId &&
        activeSessionId &&
        payloadSessionId !== activeSessionId,
    );
}
