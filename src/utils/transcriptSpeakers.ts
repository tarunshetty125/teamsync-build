export function getTranscriptSpeakerLabel(speaker: string | null | undefined): string {
    const normalized = (speaker || '').trim();
    if (!normalized) return 'Speaker';

    const lower = normalized.toLowerCase();
    if (lower === 'user') return 'You';
    if (lower === 'interviewer') return 'Them';
    if (lower === 'assistant' || lower === 'ai' || lower === 'model') return 'Assistant';

    return normalized;
}

export function isHiddenTranscriptSpeaker(speaker: string | null | undefined): boolean {
    const lower = (speaker || '').trim().toLowerCase();
    return lower === 'system' || lower === 'ai' || lower === 'assistant' || lower === 'model';
}
