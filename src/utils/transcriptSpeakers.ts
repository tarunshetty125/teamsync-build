export interface TranscriptSpeakerLike {
    speaker?: string | null;
    speakerId?: string | null;
    speakerLabel?: string | null;
}

const normalize = (value: string | null | undefined): string => (value || '').trim();
const normalizeLower = (value: string | null | undefined): string => normalize(value).toLowerCase();

const resolveSpeakerAlias = (value: string | null | undefined): string | null => {
    const lower = normalizeLower(value);
    if (lower === 'speaker_0') return 'You';
    if (lower === 'speaker_1') return 'Interviewer';
    return null;
};

export function isTranscriptRoleToken(value: string | null | undefined): boolean {
    const normalized = normalize(value);
    if (!normalized) return false;

    const lower = normalized.toLowerCase();
    return lower === 'user' || lower === 'interviewer' || lower === 'assistant' || lower === 'ai' || lower === 'model' || lower === 'system';
}

export function isCanonicalTranscriptSpeaker(value: string | null | undefined): boolean {
    const normalized = normalize(value);
    if (!normalized) return false;

    const lower = normalized.toLowerCase();
    return lower === 'user' || lower === 'interviewer' || lower === 'assistant';
}

export function getTranscriptSpeakerLabel(speaker: string | null | undefined): string {
    const normalized = normalize(speaker);
    if (!normalized) return 'Speaker';

    const alias = resolveSpeakerAlias(normalized);
    if (alias) return alias;

    const lower = normalized.toLowerCase();
    if (lower === 'user') return 'You';
    if (lower === 'interviewer') return 'Interviewer';
    if (lower === 'assistant' || lower === 'ai' || lower === 'model') return 'Assistant';
    if (lower === 'system') return 'System';

    return normalized;
}

export function getTranscriptDisplayLabel(transcript: string | TranscriptSpeakerLike | null | undefined): string {
    if (typeof transcript === 'string' || transcript == null) {
        const speaker = typeof transcript === 'string' ? transcript : undefined;
        return getTranscriptSpeakerLabel(speaker);
    }

    const speakerLabel = normalize(transcript.speakerLabel);
    if (speakerLabel) {
        const alias = resolveSpeakerAlias(speakerLabel);
        if (alias) return alias;
        return isTranscriptRoleToken(speakerLabel) ? getTranscriptSpeakerLabel(speakerLabel) : speakerLabel;
    }

    const speaker = normalize(transcript.speaker);
    if (speaker) {
        const alias = resolveSpeakerAlias(speaker);
        if (alias) return alias;
        return isTranscriptRoleToken(speaker) ? getTranscriptSpeakerLabel(speaker) : speaker;
    }

    const speakerId = normalize(transcript.speakerId);
    if (speakerId) {
        const alias = resolveSpeakerAlias(speakerId);
        if (alias) return alias;
        return speakerId;
    }

    return 'Speaker';
}

export function isHiddenTranscriptSpeaker(speaker: string | null | undefined): boolean {
    const lower = normalize(speaker).toLowerCase();
    return lower === 'system' || lower === 'ai' || lower === 'assistant' || lower === 'model';
}
