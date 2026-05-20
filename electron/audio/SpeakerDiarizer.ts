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
    firstSeenAt: number;
    lastFinalAt: number;
    totalFinalTurns: number;
    totalFinalWordCount: number;
    totalFinalCharCount: number;
    averageFinalWordCount: number;
    averageFinalGapMs: number;
    averageConfidence: number;
    isLocked: boolean;
    questionCount: number;
    answerCount: number;
    shortTurnCount: number;
    longTurnCount: number;
    lastConfidence: number;
    lastReason: string;
}

interface RecentFinalTurn {
    speakerId: string;
    timestamp: number;
    wordCount: number;
    charCount: number;
    isQuestion: boolean;
    isAnswerLike: boolean;
}

interface SpeakerTextFeatures {
    trimmedText: string;
    wordCount: number;
    charCount: number;
    isQuestion: boolean;
    isAnswerLike: boolean;
}

interface SpeakerScore {
    speaker: ExternalSpeakerState;
    score: number;
    reason: string;
    createdNewSpeaker: boolean;
}

interface SpeakerAssignmentDecision {
    speaker: ExternalSpeakerState;
    switched: boolean;
    confidence: number;
    reason: string;
    createdNewSpeaker: boolean;
}

interface ConversationProfile {
    totalTurns: number;
    uniqueSpeakerCount: number;
    alternationRatio: number;
    lastSpeakerId: string | null;
    previousSpeakerId: string | null;
}

interface SpeakerModeTuning {
    switchConfidenceThreshold: number;
    newSpeakerConfidenceThreshold: number;
    requiredConsecutiveSupport: number;
    retentionBonus: number;
    contradictionMargin: number;
    interruptionWindowMs: number;
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
const SPEAKER_MEMORY_WINDOW_MS = 60_000;
const SPEAKER_SOFT_DECAY_MS = 45_000;
const SPEAKER_HARD_DECAY_MS = 120_000;
const SWITCH_COOLDOWN_MS = 1_500;
const SHORT_INTERRUPTION_TOLERANCE_MS = 2_000;
const PARTIAL_SWITCH_MULTIPLIER = 0.35;
const PARTIAL_SWITCH_THRESHOLD_BUMP = 0.12;
const PARTIAL_REQUIRED_SUPPORT_BUMP = 1;
const DEFAULT_REQUIRED_CONTRADICTIONS = 3;
const DEFAULT_REQUIRED_NEW_SPEAKER_CONFIRMATIONS = 2;
const RECENT_TURN_CAP = 24;
const DEBUG_DIARIZER = process.env.TEAMSYNC_DIARIZER_DEBUG === 'true' || process.env.DEBUG_DIARIZER === 'true';

export class SpeakerDiarizer {
    private mode: ModeTemplateId = 'general';
    private meetingTitle = '';
    private externalSpeakers = new Map<string, ExternalSpeakerState>();
    private currentExternalSpeakerId: string = 'speaker_1';
    private nextExternalSpeakerIndex = 1;
    private recentFinalTurns: RecentFinalTurn[] = [];
    private pendingSwitchCandidateId: string | null = null;
    private pendingSwitchCandidateStreak = 0;
    private lastSwitchAt = 0;
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
        this.recentFinalTurns = [];
        this.pendingSwitchCandidateId = null;
        this.pendingSwitchCandidateStreak = 0;
        this.lastSwitchAt = 0;
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

        const previousExternalActivityAt = this.lastExternalActivityAt;
        this.lastExternalActivityAt = input.timestamp;

        const features = this.buildTextFeatures(text);
        const currentSpeaker = this.getOrCreateSpeaker(this.currentExternalSpeakerId, 1);

        const decision = input.final
            ? this.assignExternalSpeakerForFinal(features, input.timestamp, previousExternalActivityAt)
            : {
                speaker: currentSpeaker,
                switched: false,
                createdNewSpeaker: false,
                confidence: this.getHoldConfidence(currentSpeaker, input.timestamp),
                reason: 'partial-hold',
            };

        decision.speaker.lastSeenAt = input.timestamp;

        if (input.final && text) {
            this.applyFinalSpeakerStats(decision.speaker, features, input.timestamp, decision.confidence, decision.reason, decision.switched);
            this.lastExternalFinal = {
                speakerId: decision.speaker.id,
                text,
                timestamp: input.timestamp,
            };
            this.recordRecentFinalTurn(decision.speaker.id, features, input.timestamp);
            this.pruneRecentFinalTurns(input.timestamp);

            if (decision.switched) {
                this.lastSwitchAt = input.timestamp;
            }

            this.logDecision(decision, features, input.timestamp);
        }

        this.currentExternalSpeakerId = decision.speaker.id;

        return {
            speakerId: decision.speaker.id,
            speakerLabel: decision.speaker.label,
            speakerRole: 'interviewer',
            switched: decision.switched,
            activeSpeakerCount: this.externalSpeakers.size + 1,
        };
    }

    private getModeConfig(): ModeSpeakerConfig {
        return MODE_SPEAKER_CONFIG[this.mode] ?? MODE_SPEAKER_CONFIG.general;
    }

    private buildTextFeatures(text: string): SpeakerTextFeatures {
        const trimmedText = text.trim();
        const wordCount = trimmedText ? trimmedText.split(/\s+/).filter(Boolean).length : 0;

        return {
            trimmedText,
            wordCount,
            charCount: trimmedText.length,
            isQuestion: this.looksLikeQuestion(trimmedText),
            isAnswerLike: this.looksLikeAnswer(trimmedText),
        };
    }

    private getConversationProfile(timestamp: number): ConversationProfile {
        this.pruneRecentFinalTurns(timestamp);
        const recentTurns = this.recentFinalTurns;

        if (recentTurns.length === 0) {
            return {
                totalTurns: 0,
                uniqueSpeakerCount: 0,
                alternationRatio: 0,
                lastSpeakerId: null,
                previousSpeakerId: null,
            };
        }

        let alternations = 0;
        for (let i = 1; i < recentTurns.length; i++) {
            if (recentTurns[i].speakerId !== recentTurns[i - 1].speakerId) {
                alternations += 1;
            }
        }

        const speakerCounts = new Map<string, number>();
        for (const turn of recentTurns) {
            speakerCounts.set(turn.speakerId, (speakerCounts.get(turn.speakerId) ?? 0) + 1);
        }

        return {
            totalTurns: recentTurns.length,
            uniqueSpeakerCount: speakerCounts.size,
            alternationRatio: recentTurns.length > 1 ? alternations / (recentTurns.length - 1) : 0,
            lastSpeakerId: recentTurns[recentTurns.length - 1]?.speakerId ?? null,
            previousSpeakerId: recentTurns[recentTurns.length - 2]?.speakerId ?? null,
        };
    }

    private getModeTuning(profile: ConversationProfile, features: SpeakerTextFeatures): SpeakerModeTuning {
        const stableTwoPerson = profile.uniqueSpeakerCount === 2
            && profile.totalTurns >= 4
            && profile.alternationRatio >= 0.66;

        let switchConfidenceThreshold = 0.74;
        let newSpeakerConfidenceThreshold = 0.72;
        let requiredConsecutiveSupport = 2;
        let retentionBonus = 0.12;
        let contradictionMargin = 0.08;
        let interruptionWindowMs = SHORT_INTERRUPTION_TOLERANCE_MS;

        switch (this.mode) {
            case 'technical-interview':
            case 'recruiting':
            case 'looking-for-work':
                switchConfidenceThreshold = 0.82;
                newSpeakerConfidenceThreshold = 0.76;
                requiredConsecutiveSupport = DEFAULT_REQUIRED_CONTRADICTIONS;
                retentionBonus = 0.22;
                contradictionMargin = 0.12;
                break;
            case 'sales':
                switchConfidenceThreshold = 0.78;
                newSpeakerConfidenceThreshold = 0.74;
                requiredConsecutiveSupport = DEFAULT_REQUIRED_CONTRADICTIONS;
                retentionBonus = 0.18;
                contradictionMargin = 0.10;
                break;
            case 'team-meet':
                switchConfidenceThreshold = 0.68;
                newSpeakerConfidenceThreshold = 0.70;
                requiredConsecutiveSupport = 2;
                retentionBonus = 0.08;
                contradictionMargin = 0.06;
                break;
            case 'lecture':
                switchConfidenceThreshold = 0.74;
                newSpeakerConfidenceThreshold = 0.72;
                requiredConsecutiveSupport = 2;
                retentionBonus = 0.12;
                contradictionMargin = 0.08;
                break;
            case 'general':
            default:
                switchConfidenceThreshold = 0.76;
                newSpeakerConfidenceThreshold = 0.74;
                requiredConsecutiveSupport = DEFAULT_REQUIRED_CONTRADICTIONS;
                retentionBonus = 0.14;
                contradictionMargin = 0.08;
                break;
        }

        if (stableTwoPerson && this.mode !== 'team-meet') {
            switchConfidenceThreshold += 0.08;
            newSpeakerConfidenceThreshold += 0.04;
            requiredConsecutiveSupport = DEFAULT_REQUIRED_CONTRADICTIONS;
            retentionBonus += 0.12;
            contradictionMargin += 0.02;
        }

        if (stableTwoPerson && this.mode === 'team-meet') {
            switchConfidenceThreshold += 0.03;
            newSpeakerConfidenceThreshold += 0.02;
            requiredConsecutiveSupport = 2;
            retentionBonus += 0.04;
        }

        if (features.isQuestion && features.wordCount <= 8) {
            retentionBonus += 0.03;
        }

        return {
            switchConfidenceThreshold,
            newSpeakerConfidenceThreshold,
            requiredConsecutiveSupport,
            retentionBonus,
            contradictionMargin,
            interruptionWindowMs,
        };
    }

    private buildProvisionalSpeaker(index: number, timestamp: number): ExternalSpeakerState {
        return {
            id: `speaker_${index}`,
            label: this.buildExternalLabel(index),
            turnCount: 0,
            lastSeenAt: 0,
            firstSeenAt: timestamp,
            lastFinalAt: 0,
            totalFinalTurns: 0,
            totalFinalWordCount: 0,
            totalFinalCharCount: 0,
            averageFinalWordCount: 0,
            averageFinalGapMs: 0,
            averageConfidence: 0,
            isLocked: false,
            questionCount: 0,
            answerCount: 0,
            shortTurnCount: 0,
            longTurnCount: 0,
            lastConfidence: 0,
            lastReason: '',
        };
    }

    private getOrCreateSpeaker(id: string, fallbackIndex: number): ExternalSpeakerState {
        const existing = this.externalSpeakers.get(id);
        if (existing) {
            return existing;
        }

        return this.ensureExternalSpeaker(id, fallbackIndex, 0);
    }

    private getCandidateSpeakers(timestamp: number): Array<{ speaker: ExternalSpeakerState; createdNewSpeaker: boolean }> {
        const candidates = Array.from(this.externalSpeakers.values()).map((speaker) => ({
            speaker,
            createdNewSpeaker: false,
        }));

        const config = this.getModeConfig();
        if (this.externalSpeakers.size < config.maxExternalSpeakers) {
            const nextIndex = Math.max(1, this.externalSpeakers.size + 1);
            const provisionalId = `speaker_${nextIndex}`;

            if (!this.externalSpeakers.has(provisionalId)) {
                candidates.push({
                    speaker: this.buildProvisionalSpeaker(nextIndex, timestamp),
                    createdNewSpeaker: true,
                });
            }
        }

        return candidates;
    }

    private assignExternalSpeakerForFinal(
        features: SpeakerTextFeatures,
        timestamp: number,
        previousExternalActivityAt: number
    ): SpeakerAssignmentDecision {
        const currentSpeaker = this.getOrCreateSpeaker(this.currentExternalSpeakerId, 1);
        const profile = this.getConversationProfile(timestamp);
        const tuning = this.getModeTuning(profile, features);
        const candidateScores = this.getCandidateSpeakers(timestamp)
            .map((candidate) => this.scoreSpeakerCandidate(candidate.speaker, candidate.createdNewSpeaker, features, profile, tuning, timestamp, currentSpeaker.id, previousExternalActivityAt))
            .sort((a, b) => b.score - a.score);

        const best = candidateScores[0] ?? {
            speaker: currentSpeaker,
            score: 0.5,
            reason: 'current',
            createdNewSpeaker: false,
        };

        const currentScore = candidateScores.find((candidate) => candidate.speaker.id === currentSpeaker.id) ?? {
            speaker: currentSpeaker,
            score: 0.5,
            reason: 'current',
            createdNewSpeaker: false,
        };

        const currentSpeakerGap = currentSpeaker.lastSeenAt > 0 ? Math.max(0, timestamp - currentSpeaker.lastSeenAt) : Number.POSITIVE_INFINITY;
        let requiredSupport = best.createdNewSpeaker ? DEFAULT_REQUIRED_NEW_SPEAKER_CONFIRMATIONS : tuning.requiredConsecutiveSupport;
        let switchThreshold = best.createdNewSpeaker ? tuning.newSpeakerConfidenceThreshold : tuning.switchConfidenceThreshold;
        let contradictionMargin = tuning.contradictionMargin;

        if (currentSpeakerGap > SPEAKER_HARD_DECAY_MS) {
            requiredSupport = 1;
            switchThreshold = Math.max(0.56, switchThreshold - 0.16);
            contradictionMargin = Math.max(0.04, contradictionMargin - 0.04);
        } else if (currentSpeakerGap > SPEAKER_SOFT_DECAY_MS) {
            requiredSupport = Math.min(requiredSupport, 2);
            switchThreshold -= 0.06;
        }

        if (timestamp - this.lastSwitchAt < SWITCH_COOLDOWN_MS) {
            requiredSupport += 1;
            switchThreshold += 0.04;
        }

        if (this.lastUserActivityAt > 0 && (timestamp - this.lastUserActivityAt) <= tuning.interruptionWindowMs) {
            requiredSupport += 1;
            switchThreshold += 0.04;
        }

        if (best.speaker.id !== currentSpeaker.id && best.score >= switchThreshold && (best.score - currentScore.score) >= contradictionMargin) {
            if (this.pendingSwitchCandidateId === best.speaker.id) {
                this.pendingSwitchCandidateStreak += 1;
            } else {
                this.pendingSwitchCandidateId = best.speaker.id;
                this.pendingSwitchCandidateStreak = 1;
            }

            if (this.pendingSwitchCandidateStreak >= requiredSupport) {
                const actualSpeaker = best.createdNewSpeaker
                    ? this.ensureExternalSpeaker(best.speaker.id, this.extractIndex(best.speaker.id) ?? this.externalSpeakers.size + 1, timestamp)
                    : this.ensureExternalSpeaker(best.speaker.id, this.extractIndex(best.speaker.id) ?? 1, timestamp);

                this.pendingSwitchCandidateId = null;
                this.pendingSwitchCandidateStreak = 0;

                return {
                    speaker: actualSpeaker,
                    switched: true,
                    createdNewSpeaker: best.createdNewSpeaker,
                    confidence: this.clampConfidence(best.score),
                    reason: best.reason,
                };
            }
        } else if (best.speaker.id === currentSpeaker.id) {
            this.pendingSwitchCandidateId = null;
            this.pendingSwitchCandidateStreak = 0;
        } else if (this.pendingSwitchCandidateId !== best.speaker.id) {
            this.pendingSwitchCandidateId = null;
            this.pendingSwitchCandidateStreak = 0;
        }

        return {
            speaker: currentSpeaker,
            switched: false,
            createdNewSpeaker: false,
            confidence: this.clampConfidence(currentScore.score),
            reason: currentScore.reason,
        };
    }

    private scoreSpeakerCandidate(
        speaker: ExternalSpeakerState,
        createdNewSpeaker: boolean,
        features: SpeakerTextFeatures,
        profile: ConversationProfile,
        tuning: SpeakerModeTuning,
        timestamp: number,
        currentSpeakerId: string,
        previousExternalActivityAt: number
    ): SpeakerScore {
        let score = 0.34;
        const reasons: string[] = [];

        if (speaker.id === currentSpeakerId) {
            score += tuning.retentionBonus;
            reasons.push('current');
        }

        if (speaker.isLocked) {
            score += 0.06;
            reasons.push('locked');
        }

        if (speaker.turnCount > 0) {
            score += Math.min(0.14, speaker.turnCount * 0.03);
            reasons.push('history');
        }

        if (speaker.lastSeenAt > 0) {
            const inactivityMs = Math.max(0, timestamp - speaker.lastSeenAt);
            if (inactivityMs <= 5_000) {
                score += 0.22;
                reasons.push('recency');
            } else if (inactivityMs <= SPEAKER_SOFT_DECAY_MS) {
                score += 0.14;
                reasons.push('recency');
            } else if (inactivityMs <= SPEAKER_HARD_DECAY_MS) {
                score -= 0.04;
                reasons.push('decay');
            } else {
                score -= 0.12;
                reasons.push('decay-hard');
            }
        } else if (createdNewSpeaker) {
            score -= 0.02;
            reasons.push('new');
        }

        if (speaker.averageFinalGapMs > 0 && speaker.lastFinalAt > 0) {
            const gapFromSpeaker = Math.max(0, timestamp - speaker.lastFinalAt);
            const ratio = gapFromSpeaker / speaker.averageFinalGapMs;
            if (ratio >= 0.7 && ratio <= 1.4) {
                score += 0.08;
                reasons.push('cadence');
            } else if (gapFromSpeaker <= speaker.averageFinalGapMs * 0.4) {
                score -= 0.04;
                reasons.push('cadence-fast');
            }
        }

        const avgWords = speaker.averageFinalWordCount || 0;
        if (features.wordCount <= 6) {
            if (avgWords <= 8) {
                score += 0.10;
                reasons.push('short-fit');
            } else if (avgWords <= 14) {
                score += 0.04;
                reasons.push('short-fit');
            } else {
                score -= 0.03;
                reasons.push('length-mismatch');
            }
        } else if (features.wordCount >= 16) {
            if (avgWords >= 16) {
                score += 0.10;
                reasons.push('long-fit');
            } else if (avgWords >= 10) {
                score += 0.04;
                reasons.push('long-fit');
            } else {
                score -= 0.02;
                reasons.push('length-mismatch');
            }
        } else if (avgWords > 0) {
            const diffRatio = Math.abs(features.wordCount - avgWords) / Math.max(1, avgWords);
            if (diffRatio <= 0.3) {
                score += 0.06;
                reasons.push('length-fit');
            } else if (diffRatio >= 0.8) {
                score -= 0.03;
                reasons.push('length-mismatch');
            }
        }

        if (features.isQuestion) {
            if (avgWords <= 12 || avgWords === 0) {
                score += 0.08;
                reasons.push('question');
            } else {
                score += 0.03;
                reasons.push('question');
            }
        }

        if (features.isAnswerLike) {
            if (avgWords >= 12) {
                score += 0.05;
                reasons.push('answer');
            } else {
                score += 0.02;
                reasons.push('answer');
            }
        }

        if (profile.totalTurns >= 4 && profile.uniqueSpeakerCount === 2) {
            if (speaker.id === profile.previousSpeakerId && profile.alternationRatio >= 0.66) {
                score += 0.14;
                reasons.push('alternation');
            }

            if (speaker.id === profile.lastSpeakerId) {
                score += 0.05;
                reasons.push('continuity');
            }
        }

        if (previousExternalActivityAt > 0) {
            const overlapMs = Math.abs(timestamp - previousExternalActivityAt);
            if (overlapMs <= OVERLAP_WINDOW_MS) {
                if (speaker.id === currentSpeakerId) {
                    score += 0.05;
                    reasons.push('overlap-hold');
                } else {
                    score -= 0.05;
                    reasons.push('overlap-block');
                }
            }
        }

        if (this.lastUserActivityAt > 0 && (timestamp - this.lastUserActivityAt) <= tuning.interruptionWindowMs) {
            if (speaker.id === currentSpeakerId) {
                score += 0.06;
                reasons.push('interrupt-retain');
            } else {
                score -= 0.10;
                reasons.push('interrupt-block');
            }
        }

        if (this.mode === 'technical-interview' || this.mode === 'recruiting' || this.mode === 'looking-for-work') {
            if (features.wordCount <= 10) {
                score += avgWords <= 12 || avgWords === 0 ? 0.04 : -0.01;
                reasons.push('mode-short');
            }
            if (features.wordCount >= 18) {
                score += avgWords >= 14 ? 0.04 : 0;
                reasons.push('mode-long');
            }
        } else if (this.mode === 'sales') {
            if (features.wordCount <= 12) {
                score += avgWords <= 14 || avgWords === 0 ? 0.05 : -0.01;
                reasons.push('mode-sales');
            }
        } else if (this.mode === 'team-meet') {
            score += Math.min(0.03, speaker.turnCount * 0.01);
            reasons.push('team-meet');
        }

        score = this.clampConfidence(score);

        return {
            speaker,
            score,
            reason: reasons.slice(0, 3).join('+') || 'score',
            createdNewSpeaker,
        };
    }

    private applyFinalSpeakerStats(
        speaker: ExternalSpeakerState,
        features: SpeakerTextFeatures,
        timestamp: number,
        confidence: number,
        reason: string,
        switched: boolean
    ): void {
        const previousFinalAt = speaker.lastFinalAt;
        if (previousFinalAt > 0 && timestamp > previousFinalAt) {
            const gap = timestamp - previousFinalAt;
            speaker.averageFinalGapMs = speaker.averageFinalGapMs > 0
                ? (speaker.averageFinalGapMs * 0.72) + (gap * 0.28)
                : gap;
        }

        speaker.turnCount += 1;
        speaker.totalFinalTurns += 1;
        speaker.totalFinalWordCount += features.wordCount;
        speaker.totalFinalCharCount += features.charCount;
        speaker.averageFinalWordCount = speaker.averageFinalWordCount > 0
            ? (speaker.averageFinalWordCount * 0.72) + (features.wordCount * 0.28)
            : features.wordCount;
        speaker.lastSeenAt = timestamp;
        speaker.lastFinalAt = timestamp;
        speaker.lastConfidence = confidence;
        speaker.lastReason = reason;
        speaker.averageConfidence = speaker.averageConfidence > 0
            ? (speaker.averageConfidence * 0.75) + (confidence * 0.25)
            : confidence;

        if (features.isQuestion) {
            speaker.questionCount += 1;
        }

        if (features.isAnswerLike) {
            speaker.answerCount += 1;
        }

        if (features.wordCount <= 8) {
            speaker.shortTurnCount += 1;
        }

        if (features.wordCount >= 16) {
            speaker.longTurnCount += 1;
        }

        speaker.isLocked = speaker.turnCount >= 2 || speaker.averageConfidence >= 0.75 || switched;
    }

    private recordRecentFinalTurn(speakerId: string, features: SpeakerTextFeatures, timestamp: number): void {
        this.recentFinalTurns.push({
            speakerId,
            timestamp,
            wordCount: features.wordCount,
            charCount: features.charCount,
            isQuestion: features.isQuestion,
            isAnswerLike: features.isAnswerLike,
        });

        if (this.recentFinalTurns.length > RECENT_TURN_CAP) {
            this.recentFinalTurns = this.recentFinalTurns.slice(-RECENT_TURN_CAP);
        }
    }

    private pruneRecentFinalTurns(timestamp: number): void {
        const cutoff = timestamp - SPEAKER_MEMORY_WINDOW_MS;
        if (this.recentFinalTurns.length === 0) return;

        this.recentFinalTurns = this.recentFinalTurns.filter((turn) => turn.timestamp >= cutoff);
    }

    private getHoldConfidence(speaker: ExternalSpeakerState, timestamp: number): number {
        const inactivityMs = speaker.lastSeenAt > 0 ? Math.max(0, timestamp - speaker.lastSeenAt) : Number.POSITIVE_INFINITY;
        if (inactivityMs <= 5_000) return 0.86;
        if (inactivityMs <= SPEAKER_SOFT_DECAY_MS) return 0.74;
        if (inactivityMs <= SPEAKER_HARD_DECAY_MS) return 0.62;
        return 0.54;
    }

    private logDecision(decision: SpeakerAssignmentDecision, features: SpeakerTextFeatures, timestamp: number): void {
        if (!DEBUG_DIARIZER) return;

        const label = decision.speaker.label;
        const confidence = decision.confidence.toFixed(2);
        const mode = this.mode;
        const action = decision.switched ? 'reassigned' : 'held';
        const reason = decision.reason || 'score';
        const turnType = features.isQuestion ? 'question' : features.isAnswerLike ? 'answer' : 'statement';

        console.log(`[Diarizer] speaker=${label} confidence=${confidence} action=${action} reason=${reason} mode=${mode} turn=${turnType} t=${timestamp}`);
    }

    private clampConfidence(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(0.99, Number(value.toFixed(4))));
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
            firstSeenAt: timestamp,
            lastFinalAt: 0,
            totalFinalTurns: 0,
            totalFinalWordCount: 0,
            totalFinalCharCount: 0,
            averageFinalWordCount: 0,
            averageFinalGapMs: 0,
            averageConfidence: 0,
            isLocked: false,
            questionCount: 0,
            answerCount: 0,
            shortTurnCount: 0,
            longTurnCount: 0,
            lastConfidence: 0,
            lastReason: '',
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
