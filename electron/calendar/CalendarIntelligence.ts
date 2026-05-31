import { EventEmitter } from 'events';
import Store from 'electron-store';
import { MODE_TEMPLATE_MAP } from '../../src/lib/modes/templateCatalog';

type GoogleCalendarEventLike = {
    id: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string } | { date?: string };
    end?: { dateTime?: string } | { date?: string };
    title?: string;
    startTime?: string;
    endTime?: string;
    link?: string;
    source?: 'google';
};

type NormalizedEvent = {
    id: string;
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
};

type RecommendationModeId =
    | 'technical-interview'
    | 'sales'
    | 'lecture'
    | 'team-meet'
    | 'recruiting'
    | 'looking-for-work';

interface ModeRule {
    modeId: RecommendationModeId;
    keywords: Array<{ phrase: string; weight: number }>;
}

export interface CalendarModeRecommendation {
    eventId: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    recommendedMode: RecommendationModeId;
    recommendedModeLabel: string;
    confidence: number;
    matchedSignals: string[];
    summary: string;
    suggestedReferences: string[];
}

interface PersistedCalendarIntelligenceState {
    dismissedEventIds: Record<string, number>;
}

const STORE_NAME = 'teamsync-calendar-intelligence';
const EVENT_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
// Persist dismissals long enough that a dismissed meeting card does not
// immediately reappear during the same day or app session.
const DISMISS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MINIMUM_SCORE = 30;

const MODE_RULES: ModeRule[] = [
    {
        modeId: 'technical-interview',
        keywords: [
            { phrase: 'interview', weight: 40 },
            { phrase: 'backend', weight: 20 },
            { phrase: 'frontend', weight: 20 },
            { phrase: 'sde', weight: 20 },
            { phrase: 'coding', weight: 20 },
            { phrase: 'leetcode', weight: 20 },
            { phrase: 'algorithm', weight: 20 },
            { phrase: 'system design', weight: 20 },
            { phrase: 'dsa', weight: 20 },
            { phrase: 'developer', weight: 20 },
            { phrase: 'engineer', weight: 20 },
            { phrase: 'role', weight: 10 },
            { phrase: 'technical round', weight: 20 },
        ],
    },
    {
        modeId: 'sales',
        keywords: [
            { phrase: 'sales', weight: 28 },
            { phrase: 'proposal', weight: 22 },
            { phrase: 'pricing', weight: 20 },
            { phrase: 'client', weight: 18 },
            { phrase: 'demo', weight: 18 },
            { phrase: 'customer', weight: 18 },
            { phrase: 'deal', weight: 18 },
            { phrase: 'renewal', weight: 18 },
            { phrase: 'pitch', weight: 18 },
        ],
    },
    {
        modeId: 'lecture',
        keywords: [
            { phrase: 'lecture', weight: 28 },
            { phrase: 'class', weight: 20 },
            { phrase: 'seminar', weight: 20 },
            { phrase: 'course', weight: 18 },
            { phrase: 'dbms', weight: 24 },
            { phrase: 'os', weight: 20 },
            { phrase: 'college', weight: 16 },
            { phrase: 'lab', weight: 16 },
            { phrase: 'assignment', weight: 16 },
        ],
    },
    {
        modeId: 'team-meet',
        keywords: [
            { phrase: 'standup', weight: 24 },
            { phrase: 'planning', weight: 22 },
            { phrase: 'retro', weight: 22 },
            { phrase: 'team sync', weight: 26 },
            { phrase: 'sprint', weight: 22 },
            { phrase: 'meeting', weight: 10 },
            { phrase: 'review', weight: 14 },
            { phrase: 'internal', weight: 16 },
        ],
    },
    {
        modeId: 'recruiting',
        keywords: [
            { phrase: 'candidate', weight: 24 },
            { phrase: 'recruiting', weight: 24 },
            { phrase: 'resume', weight: 18 },
            { phrase: 'hiring', weight: 20 },
            { phrase: 'screening', weight: 18 },
            { phrase: 'interviewer', weight: 18 },
            { phrase: 'interview panel', weight: 22 },
        ],
    },
    {
        modeId: 'looking-for-work',
        keywords: [
            { phrase: 'placement', weight: 34 },
            { phrase: 'mock interview', weight: 48 },
            { phrase: 'career', weight: 22 },
            { phrase: 'resume review', weight: 40 },
            { phrase: 'behavioral', weight: 26 },
            { phrase: 'job prep', weight: 34 },
        ],
    },
];

function normalizeCalendarEvent(event: GoogleCalendarEventLike): NormalizedEvent | null {
    const startTime = (event.start && 'dateTime' in event.start ? event.start.dateTime : undefined) || event.startTime;
    const endTime = (event.end && 'dateTime' in event.end ? event.end.dateTime : undefined) || event.endTime;

    if (!startTime || !endTime) return null;

    return {
        id: event.id,
        summary: (event.summary || event.title || 'Untitled event').trim(),
        description: event.description,
        startTime,
        endTime,
    };
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordRegex(phrase: string): RegExp {
    const normalized = phrase.trim().toLowerCase().split(/\s+/).map(escapeRegex).join('\\s+');
    return new RegExp(`(^|[^a-z0-9])${normalized}(?=$|[^a-z0-9])`, 'i');
}

function titleCaseSignal(signal: string): string {
    return signal.replace(/\b\w/g, (char) => char.toUpperCase());
}

function getTimeBoost(event: NormalizedEvent, now: number): number {
    const start = new Date(event.startTime).getTime();
    const deltaMs = start - now;
    if (deltaMs <= 15 * 60 * 1000) return 20;
    if (deltaMs <= 60 * 60 * 1000) return 10;
    return 0;
}

function buildSuggestedReferences(modeId: RecommendationModeId): string[] {
    if (modeId === 'technical-interview') {
        return ['Resume', 'System Design Notes'];
    }

    return MODE_TEMPLATE_MAP[modeId]?.suggestedReferenceFiles?.slice(0, 2) ?? [];
}

function buildSummary(modeId: RecommendationModeId, matchedSignals: string[]): string {
    const label = MODE_TEMPLATE_MAP[modeId]?.name ?? 'Meeting';
    if (!matchedSignals.length) {
        return `${label} signals detected.`;
    }

    if (matchedSignals.length === 1) {
        return `${label} detected from ${matchedSignals[0]} signal.`;
    }

    return `${label} detected with ${matchedSignals.join(' + ')} signals.`;
}

function isSameRecommendation(
    a: CalendarModeRecommendation | null,
    b: CalendarModeRecommendation | null
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;

    return a.eventId === b.eventId
        && a.recommendedMode === b.recommendedMode
        && a.confidence === b.confidence
        && a.summary === b.summary
        && a.matchedSignals.join('|') === b.matchedSignals.join('|');
}

class MeetingClassifier {
    public classify(event: NormalizedEvent, now: number): CalendarModeRecommendation | null {
        const text = `${event.summary}\n${event.description ?? ''}`.toLowerCase();

        let bestMode: RecommendationModeId | null = null;
        let bestScore = 0;
        let bestSignals: string[] = [];

        for (const rule of MODE_RULES) {
            const matchedSignals = rule.keywords
                .filter((keyword) => keywordRegex(keyword.phrase).test(text))
                .map((keyword) => keyword.phrase);

            if (!matchedSignals.length) continue;

            const score = rule.keywords
                .filter((keyword) => matchedSignals.includes(keyword.phrase))
                .reduce((sum, keyword) => sum + keyword.weight, 0);

            if (score > bestScore) {
                bestScore = score;
                bestMode = rule.modeId;
                bestSignals = matchedSignals;
            }
        }

        if (!bestMode || bestScore < MINIMUM_SCORE) {
            return null;
        }

        const confidence = Math.min(99, bestScore + getTimeBoost(event, now));
        const recommendedModeLabel = MODE_TEMPLATE_MAP[bestMode]?.name ?? bestMode;
        const matchedSignals = bestSignals.map(titleCaseSignal);

        return {
            eventId: event.id,
            title: event.summary,
            description: event.description,
            startTime: event.startTime,
            endTime: event.endTime,
            recommendedMode: bestMode,
            recommendedModeLabel,
            confidence,
            matchedSignals,
            summary: buildSummary(bestMode, matchedSignals),
            suggestedReferences: buildSuggestedReferences(bestMode),
        };
    }
}

export class CalendarIntelligence extends EventEmitter {
    private static instance: CalendarIntelligence;
    private readonly store: Store<PersistedCalendarIntelligenceState>;
    private readonly classifier = new MeetingClassifier();
    private currentRecommendation: CalendarModeRecommendation | null = null;

    private constructor() {
        super();
        this.store = new Store<PersistedCalendarIntelligenceState>({
            name: STORE_NAME,
            defaults: {
                dismissedEventIds: {},
            },
        });
        this.pruneDismissals();
    }

    public static getInstance(): CalendarIntelligence {
        if (!CalendarIntelligence.instance) {
            CalendarIntelligence.instance = new CalendarIntelligence();
        }
        return CalendarIntelligence.instance;
    }

    public observeUpcomingEvents(events: GoogleCalendarEventLike[]): CalendarModeRecommendation | null {
        const recommendation = this.computeRecommendation(events);
        if (!isSameRecommendation(this.currentRecommendation, recommendation)) {
            this.currentRecommendation = recommendation;
            this.emit('recommendation-changed', recommendation);
        }
        return this.currentRecommendation;
    }

    public getRecommendation(): CalendarModeRecommendation | null {
        return this.currentRecommendation;
    }

    public dismissEvent(eventId: string): void {
        if (!eventId) return;

        const dismissed = this.store.get('dismissedEventIds', {});
        dismissed[eventId] = Date.now();
        this.store.set('dismissedEventIds', dismissed);
        console.log(`[CALENDAR_DISMISSAL] eventId=${eventId} persisted=true retentionMs=${DISMISS_RETENTION_MS}`);

        if (this.currentRecommendation?.eventId === eventId) {
            this.currentRecommendation = null;
            this.emit('recommendation-changed', null);
        }
    }

    public clearRecommendation(): void {
        if (this.currentRecommendation !== null) {
            this.currentRecommendation = null;
            this.emit('recommendation-changed', null);
        }
    }

    private computeRecommendation(events: GoogleCalendarEventLike[]): CalendarModeRecommendation | null {
        this.pruneDismissals();

        const now = Date.now();
        const normalizedEvents = events
            .map((event) => normalizeCalendarEvent(event))
            .filter((event): event is NormalizedEvent => Boolean(event))
            .filter((event) => {
                const start = new Date(event.startTime).getTime();
                return !Number.isNaN(start) && start >= now && start <= now + EVENT_LOOKAHEAD_MS;
            });

        let bestRecommendation: CalendarModeRecommendation | null = null;
        let bestStartTime = Number.POSITIVE_INFINITY;

        for (const event of normalizedEvents) {
            if (this.isDismissed(event.id, now)) continue;

            const recommendation = this.classifier.classify(event, now);
            if (!recommendation) continue;

            const start = new Date(event.startTime).getTime();
            if (
                !bestRecommendation
                || recommendation.confidence > bestRecommendation.confidence
                || (recommendation.confidence === bestRecommendation.confidence && start < bestStartTime)
            ) {
                bestRecommendation = recommendation;
                bestStartTime = start;
            }
        }

        return bestRecommendation;
    }
    private isDismissed(eventId: string, now: number): boolean {
        const dismissedAt = this.store.get('dismissedEventIds', {})[eventId];
        if (!dismissedAt) return false;
        return now - dismissedAt < DISMISS_RETENTION_MS;
    }

    private pruneDismissals(): void {
        const dismissed = this.store.get('dismissedEventIds', {});
        const now = Date.now();
        const nextEntries = Object.entries(dismissed).filter(([, dismissedAt]) => now - dismissedAt < DISMISS_RETENTION_MS);

        if (nextEntries.length !== Object.keys(dismissed).length) {
            this.store.set('dismissedEventIds', Object.fromEntries(nextEntries));
        }
    }
}
