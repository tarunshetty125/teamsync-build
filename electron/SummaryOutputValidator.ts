export interface SummarySectionOutput {
    title: string;
    bullets: string[];
}

export interface SummaryOutputData {
    overview?: string;
    actionItems: string[];
    keyPoints: string[];
    sections?: SummarySectionOutput[];
}

const PLACEHOLDER_PATTERNS = [
    /^<[^>]+>$/i,
    /^\[?(?:bullet|item|summary|section|point|placeholder)\s*\d+\]?$/i,
    /^summary here$/i,
    /^see detailed summary$/i,
    /^generating summary/i,
    /^tbd$/i,
    /^todo$/i,
    /^n\/?a$/i,
    /^none$/i,
    /^null$/i,
];

const FILLER_PATTERNS = [
    /^the meeting covered\b/i,
    /^discussed various\b/i,
    /^this meeting was about\b/i,
    /^the conversation was about\b/i,
];

function normalizeText(value: string): string {
    return value
        .replace(/\r/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();
}

function isPlaceholderText(value: string): boolean {
    const normalized = normalizeText(value).toLowerCase();
    return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isFillerText(value: string): boolean {
    const normalized = normalizeText(value);
    return FILLER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function parseInlineArray(value: string): string[] | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed)
            ? parsed.flatMap((item) => typeof item === 'string' ? [item] : [])
            : null;
    } catch {
        return null;
    }
}

function sanitizeBullet(value: unknown): string[] {
    if (typeof value !== 'string') {
        return [];
    }

    const normalized = normalizeText(value);
    if (!normalized) {
        return [];
    }

    const parsedArray = parseInlineArray(normalized);
    if (parsedArray) {
        return parsedArray.flatMap((item) => sanitizeBullet(item));
    }

    if (isPlaceholderText(normalized) || isFillerText(normalized)) {
        return [];
    }

    const stripped = normalized.replace(/^[-*•\d.\s]+/, '').trim();
    if (!stripped || isPlaceholderText(stripped) || isFillerText(stripped)) {
        return [];
    }

    return [stripped];
}

function sanitizeStringList(values: unknown): string[] {
    const input = Array.isArray(values) ? values : [values];
    const deduped = new Set<string>();

    for (const value of input) {
        for (const bullet of sanitizeBullet(value)) {
            const key = bullet.toLowerCase();
            if (!deduped.has(key)) {
                deduped.add(key);
            }
        }
    }

    return Array.from(deduped);
}

function sanitizeOverview(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = normalizeText(value);
    if (!normalized || isPlaceholderText(normalized) || isFillerText(normalized)) {
        return undefined;
    }

    return normalized;
}

export function sanitizeSummaryOutput(summary: Partial<SummaryOutputData> | null | undefined): SummaryOutputData {
    const sections = Array.isArray(summary?.sections)
        ? summary!.sections
            .map((section) => {
                const title = typeof section?.title === 'string' ? normalizeText(section.title) : '';
                const bullets = sanitizeStringList(section?.bullets);
                if (!title || bullets.length === 0) {
                    return null;
                }
                return { title, bullets };
            })
            .filter((section): section is SummarySectionOutput => section !== null)
        : undefined;

    return {
        overview: sanitizeOverview(summary?.overview),
        actionItems: sanitizeStringList(summary?.actionItems),
        keyPoints: sanitizeStringList(summary?.keyPoints),
        sections: sections && sections.length > 0 ? sections : undefined,
    };
}
