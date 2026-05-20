import type { ModeTemplateId } from '../../src/lib/modes/types';

type TranscriptChannel = 'user' | 'interviewer';

export interface SpeakerDiarizerResetOptions {
    mode?: ModeTemplateId | null;
    meetingTitle?: string;
}

export interface SpeakerDiarizerInput {
    channel: TranscriptChannel;
    text: string;
    timestamp: number;
    final: boolean;
}

export interface SpeakerDiarizerOutput {
    speakerId: string;
    speakerLabel: string;
    speakerRole: 'user' | 'interviewer';
    switched: boolean;
    activeSpeakerCount: number;
}

interface ExternalSpeakerState {
    id: string;
    label: string;
    turnCount: number;
    lastSeenAt: number;
}

interface ModeSpeakerConfig {
    userLabel: string;
    primaryExternalLabel: string;
    secondaryExternalLabel?: string;
    additionalExternalPrefix?: string;
    maxExternalSpeakers: number;
}

const MODE_SPEAKER_CONFIG: Record<ModeTemplateId, ModeSpeakerConfig> = {
    general: {
        userLabel: 'You',
        primaryExternalLabel: 'speaker_1',
        secondaryExternalLabel: 'speaker_2',
        additionalExternalPrefix: 'speaker_',
        maxExternalSpeakers: 2,
    },
    sales: {
        userLabel: 'You',
        primaryExternalLabel: 'Client',
        secondaryExternalLabel: 'Client 2',
        additionalExternalPrefix: 'Client',
        maxExternalSpeakers: 3,
    },
    recruiting: {
        userLabel: 'You',
        primaryExternalLabel: 'Recruiter',
        secondaryExternalLabel: 'Hiring Manager',
        additionalExternalPrefix: 'Interviewer',
        maxExternalSpeakers: 2,
    },
    'team-meet': {
        userLabel: 'You',
        primaryExternalLabel: 'Team Member 1',
        secondaryExternalLabel: 'Team Member 2',
        additionalExternalPrefix: 'Team Member',
        maxExternalSpeakers: 4,
    },
    'looking-for-work': {
        userLabel: 'You',
        primaryExternalLabel: 'Interviewer',
        secondaryExternalLabel: 'Recruiter',
        additionalExternalPrefix: 'Interviewer',
        maxExternalSpeakers: 2,
    },
    lecture: {
        userLabel: 'You',
        primaryExternalLabel: 'Lecturer',
        secondaryExternalLabel: 'Student',
        additionalExternalPrefix: 'Speaker',
        maxExternalSpeakers: 2,
    },
    'technical-interview': {
        userLabel: 'You',
        primaryExternalLabel: 'Interviewer',
        secondaryExternalLabel: 'Recruiter',
        additionalExternalPrefix: 'Interviewer',
        maxExternalSpeakers: 2,
    },
};

const TURN_SWITCH_PAUSE_MS = 700;
const STRONG_SWITCH_PAUSE_MS = 2_200;
const USER_INTERRUPT_WINDOW_MS = 900;
const OVERLAP_WINDOW_MS = 450;

export class SpeakerDiarizer {
    private mode: ModeTemplateId = 'general';
    private meetingTitle = '';
    private externalSpeakers = new Map<string, ExternalSpeakerState>();
    private currentExternalSpeakerId: string = 'speaker_1';
    private nextExternalSpeakerIndex = 1;
    private lastExternalFinal:
        | {
            speakerId: string;
            text: string;
            timestamp: number;
        }
        | null = null;
    private lastExternalActivityAt = 0;
    private lastUserActivityAt = 0;
    private lastUserFinalAt = 0;

    constructor() {
        this.reset();
    }

    reset(options?: SpeakerDiarizerResetOptions): void {
        this.mode = options?.mode ?? 'general';
        this.meetingTitle = options?.meetingTitle?.trim() ?? '';
        this.externalSpeakers.clear();
        this.currentExternalSpeakerId = 'speaker_1';
        this.nextExternalSpeakerIndex = 0;
        this.lastExternalFinal = null;
        this.lastExternalActivityAt = 0;
        this.lastUserActivityAt = 0;
        this.lastUserFinalAt = 0;
        this.ensureExternalSpeaker('speaker_1', 1, 0);
    }

    setMode(mode: ModeTemplateId | null | undefined): void {
        this.mode = mode ?? 'general';
    }

    processSegment(input: SpeakerDiarizerInput): SpeakerDiarizerOutput {
        const text = input.text.trim();
        const config = this.getModeConfig();

        if (input.channel === 'user') {
            this.lastUserActivityAt = input.timestamp;
            if (input.final) {
                this.lastUserFinalAt = input.timestamp;
            }
            return {
                speakerId: 'speaker_you',
                speakerLabel: config.userLabel,
                speakerRole: 'user',
                switched: false,
                activeSpeakerCount: this.externalSpeakers.size + 1,
            };
        }

        this.lastExternalActivityAt = input.timestamp;

        const shouldSwitch = text
            ? this.shouldSwitchExternalSpeaker(text, input.timestamp)
            : false;
        const assignedSpeaker = shouldSwitch
            ? this.getNextExternalSpeaker(input.timestamp)
            : this.ensureExternalSpeaker(this.currentExternalSpeakerId, 1, input.timestamp);

        assignedSpeaker.lastSeenAt = input.timestamp;
        if (input.final && text) {
            assignedSpeaker.turnCount += 1;
            this.lastExternalFinal = {
                speakerId: assignedSpeaker.id,
                text,
                timestamp: input.timestamp,
            };
        }

        this.currentExternalSpeakerId = assignedSpeaker.id;

        return {
            speakerId: assignedSpeaker.id,
            speakerLabel: assignedSpeaker.label,
            speakerRole: 'interviewer',
            switched: shouldSwitch,
            activeSpeakerCount: this.externalSpeakers.size + 1,
        };
    }

    private getModeConfig(): ModeSpeakerConfig {
        return MODE_SPEAKER_CONFIG[this.mode] ?? MODE_SPEAKER_CONFIG.general;
    }

    private shouldSwitchExternalSpeaker(text: string, timestamp: number): boolean {
        const config = this.getModeConfig();
        if (config.maxExternalSpeakers <= 1 || !this.lastExternalFinal) {
            return false;
        }

        const gapSinceLastExternal = Math.max(0, timestamp - this.lastExternalFinal.timestamp);
        if (gapSinceLastExternal < TURN_SWITCH_PAUSE_MS) {
            return false;
        }

        const userSpokeSinceLastExternal = this.lastUserFinalAt > this.lastExternalFinal.timestamp;
        const recentUserInterruption = this.lastUserActivityAt > 0
            && (timestamp - this.lastUserActivityAt) <= USER_INTERRUPT_WINDOW_MS;
        const overlapDetected = this.lastExternalActivityAt > 0
            && Math.abs(timestamp - this.lastExternalActivityAt) <= OVERLAP_WINDOW_MS;
        const previousWasQuestion = this.looksLikeQuestion(this.lastExternalFinal.text);
        const currentLooksLikeQuestion = this.looksLikeQuestion(text);
        const currentLooksLikeAnswer = this.looksLikeAnswer(text);
        const currentLooksLikeSpeakerShift = this.looksLikeSpeakerShift(text);

        if (overlapDetected && this.externalSpeakers.size < config.maxExternalSpeakers) {
            return true;
        }

        if (currentLooksLikeSpeakerShift && gapSinceLastExternal >= TURN_SWITCH_PAUSE_MS) {
            return true;
        }

        if (!userSpokeSinceLastExternal && previousWasQuestion && currentLooksLikeAnswer) {
            return true;
        }

        if (!userSpokeSinceLastExternal && gapSinceLastExternal >= STRONG_SWITCH_PAUSE_MS && previousWasQuestion !== currentLooksLikeQuestion) {
            return true;
        }

        if (recentUserInterruption && this.externalSpeakers.size < config.maxExternalSpeakers && gapSinceLastExternal >= TURN_SWITCH_PAUSE_MS) {
            return true;
        }

        return false;
    }

    private getNextExternalSpeaker(timestamp: number): ExternalSpeakerState {
        const config = this.getModeConfig();
        if (this.externalSpeakers.size < config.maxExternalSpeakers) {
            const nextIndex = this.externalSpeakers.size + 1;
            return this.ensureExternalSpeaker(`speaker_${nextIndex}`, nextIndex, timestamp);
        }

        const others = Array.from(this.externalSpeakers.values())
            .filter((speaker) => speaker.id !== this.currentExternalSpeakerId)
            .sort((a, b) => a.lastSeenAt - b.lastSeenAt);

        return others[0] ?? this.ensureExternalSpeaker(this.currentExternalSpeakerId, 1, timestamp);
    }

    private ensureExternalSpeaker(id: string, fallbackIndex: number, timestamp: number): ExternalSpeakerState {
        const existing = this.externalSpeakers.get(id);
        if (existing) {
            if (timestamp > 0) {
                existing.lastSeenAt = timestamp;
            }
            return existing;
        }

        const index = Math.max(1, this.extractIndex(id) ?? fallbackIndex ?? (this.nextExternalSpeakerIndex + 1));
        this.nextExternalSpeakerIndex = Math.max(this.nextExternalSpeakerIndex, index);

        const created: ExternalSpeakerState = {
            id,
            label: this.buildExternalLabel(index),
            turnCount: 0,
            lastSeenAt: timestamp,
        };
        this.externalSpeakers.set(id, created);
        return created;
    }

    private extractIndex(id: string): number | null {
        const match = id.match(/(\d+)$/);
        if (!match) return null;
        const parsed = Number(match[1]);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private buildExternalLabel(index: number): string {
        const config = this.getModeConfig();
        if (index === 1) return config.primaryExternalLabel;
        if (index === 2 && config.secondaryExternalLabel) return config.secondaryExternalLabel;

        const prefix = config.additionalExternalPrefix ?? config.primaryExternalLabel;
        if (prefix === 'speaker_') {
            return `speaker_${index}`;
        }

        return `${prefix} ${index}`;
    }

    private looksLikeQuestion(text: string): boolean {
        const normalized = text.trim().toLowerCase();
        if (!normalized) return false;
        return normalized.includes('?')
            || /^(who|what|when|where|why|how|can|could|would|should|do|does|did|is|are|will|have)\b/.test(normalized);
    }

    private looksLikeAnswer(text: string): boolean {
        const normalized = text.trim().toLowerCase();
        if (!normalized) return false;
        return /^(yes|no|yeah|yep|right|correct|exactly|sure|absolutely|we did|i did|i used|we used|it was|there was|because)\b/.test(normalized);
    }

    private looksLikeSpeakerShift(text: string): boolean {
        const normalized = text.trim().toLowerCase();
        if (!normalized) return false;

        if (this.mode === 'lecture' && /\b(question|quick question|could you clarify)\b/.test(normalized)) {
            return true;
        }

        if (this.mode === 'team-meet') {
            return /\b(i can take|i'll take|i will take|from my side|adding to that|one more thing|i agree|i disagree)\b/.test(normalized);
        }

        if (this.mode === 'recruiting' || this.mode === 'technical-interview' || this.mode === 'looking-for-work') {
            return /\b(follow(?:ing)? up|next question|from a recruiting standpoint|from my side)\b/.test(normalized);
        }

        if (this.mode === 'sales') {
            return /\b(procurement|legal|finance|from our side|from my side)\b/.test(normalized);
        }

        return false;
    }
}
