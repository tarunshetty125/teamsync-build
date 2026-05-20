export interface TranscriptSpeakerLike {
    speaker?: string | null;
    speakerId?: string | null;
    speakerLabel?: string | null;
}

const normalize = (value: string | null | undefined): string => (value || '').trim();

const isRoleToken = (value: string): boolean => {
    const lower = value.toLowerCase();
    return lower === 'user' || lower === 'interviewer' || lower === 'assistant' || lower === 'ai' || lower === 'model' || lower === 'system';
};

export function getTranscriptSpeakerLabel(speaker: string | null | undefined): string {
    const normalized = normalize(speaker);
    if (!normalized) return 'Speaker';

    const lower = normalized.toLowerCase();
    if (lower === 'user') return 'You';
    if (lower === 'interviewer') return 'Interviewer';
    if (lower === 'assistant' || lower === 'ai' || lower === 'model') return 'Assistant';
    if (lower === 'system') return 'System';

    return normalized;
}

export function getTranscriptDisplayLabel(transcript: string | TranscriptSpeakerLike | null | undefined): string {
    if (typeof transcript === 'string' || transcript == null) {
        return getTranscriptSpeakerLabel(transcript ?? undefined);
    }

    const speakerLabel = normalize(transcript.speakerLabel);
    if (speakerLabel) {
        return isRoleToken(speakerLabel) ? getTranscriptSpeakerLabel(speakerLabel) : speakerLabel;
    }

    const speaker = normalize(transcript.speaker);
    if (speaker) {
        return isRoleToken(speaker) ? getTranscriptSpeakerLabel(speaker) : speaker;
    }

    const speakerId = normalize(transcript.speakerId);
    if (speakerId) {
        return speakerId;
    }

    return 'Speaker';
}

export function isHiddenTranscriptSpeaker(speaker: string | null | undefined): boolean {
    const lower = normalize(speaker).toLowerCase();
    return lower === 'system' || lower === 'ai' || lower === 'assistant' || lower === 'model';
}
