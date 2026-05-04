// electron/llm/ScreenScanLLM.ts
// Context-Aware Screen Intelligence — Cluely-style
// Captures screen → detects content type → routes to mode-specific prompt → streams response.

import { LLMHelper } from "../LLMHelper";
import { SCREEN_SCAN_PROMPT, buildScreenScanMessage } from "./prompts";

// ---------------------------------------------------------------------------
// Screen Content Mode Detection
// ---------------------------------------------------------------------------

export type ScreenContentMode =
    | 'coding'
    | 'interview_question'
    | 'slides_presentation'
    | 'document_text'
    | 'ui_general';

function normalizeScreenText(text: string): string {
    return text
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function countMatches(text: string, patterns: RegExp[]): number {
    return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function containsCodePatterns(text: string): boolean {
    const patterns = [
        /\b(function|const|let|var|class|interface|type|enum|def|import|export|return)\b/i,
        /\b(async|await|try|catch|throw|public|private|protected|static)\b/i,
        /[{}();<>]=?|=>|::|->/,
        /^\s{2,}(if|for|while|return|console\.log|print)\b/m,
        /\b(npm|yarn|pnpm|pip|cargo|go test|pytest|node)\b/i,
        /\.(ts|tsx|js|jsx|py|java|cpp|go|rs|rb|swift)\b/i,
        /```[\w-]*\n?/,
    ];

    return countMatches(text, patterns) >= 2;
}

function containsInterviewQuestion(text: string): boolean {
    const patterns = [
        /\b(what is|why did|why do|how would|walk me through|tell me about|describe|explain)\b/i,
        /\b(given|constraints?|input|output|example|examples)\b/i,
        /\b(time complexity|space complexity|big o|trade-?offs?)\b/i,
        /\?\s*$/m,
        /^\s*(q:|question:)/im,
    ];

    return countMatches(text, patterns) >= 2;
}

function looksLikeSlide(text: string): boolean {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^([•●▪■◦-]|\d+[.)])\s+/.test(line)).length;
    const shortHeadingLines = lines.filter((line) => line.length > 3 && line.length < 52 && /^[A-Z0-9][A-Za-z0-9 ,:&/-]+$/.test(line)).length;
    const patterns = [
        /\b(agenda|overview|q&a|key takeaways?|summary|roadmap|next steps)\b/i,
        /\b(slide|deck|presentation)\b/i,
        /\b(quarterly|okr|kpi|metrics|growth|funnel|revenue)\b/i,
    ];

    return bulletLines >= 2 || (shortHeadingLines >= 2 && countMatches(text, patterns) >= 1);
}

function looksLikeDocumentText(text: string): boolean {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const paragraphLikeLines = lines.filter((line) => line.split(/\s+/).length >= 10).length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return wordCount >= 90 && paragraphLikeLines >= 3;
}

/**
 * Lightweight heuristic content classifier.
 * Runs BEFORE the LLM call to select the right prompt strategy.
 * Falls through to 'ui_general' when no pattern matches confidently.
 *
 * The LLM itself also receives the detected mode so it can refine
 * its behavior if the heuristic was wrong.
 */
export function detectScreenContentMode(text: string): ScreenContentMode {
    const normalized = normalizeScreenText(text);

    if (!normalized) return 'ui_general';
    if (containsCodePatterns(normalized)) return 'coding';
    if (containsInterviewQuestion(normalized)) return 'interview_question';
    if (looksLikeSlide(normalized)) return 'slides_presentation';
    if (looksLikeDocumentText(normalized)) return 'document_text';
    return 'ui_general';
}

/**
 * Mode-specific behavior descriptors for the LLM prompt.
 */
export const MODE_BEHAVIOR: Record<ScreenContentMode, {
    label: string;
    objective: string;
    format: string;
}> = {
    coding: {
        label: '⚡ Code Analysis',
        objective: 'Find bugs, suggest optimizations, explain logic, or provide the solution.',
        format: `• Bug / Issue (if any)
• Fix or Optimization
• Key Insight or Explanation`,
    },
    interview_question: {
        label: '🎯 Interview Answer',
        objective: 'Generate a direct, concise answer the candidate can speak aloud.',
        format: `• Direct Answer (1-2 sentences)
• Key Points (2-3 bullets)`,
    },
    slides_presentation: {
        label: '📊 Slide Intelligence',
        objective: 'Summarize the slide content and generate talking points.',
        format: `• Summary (1-2 sentences)
• Talking Points (2-3 bullets)`,
    },
    document_text: {
        label: '📄 Document Insights',
        objective: 'Extract the most important insights from the document.',
        format: `• Key Insight #1
• Key Insight #2
• Key Insight #3`,
    },
    ui_general: {
        label: '🔍 Screen Analysis',
        objective: 'Explain what is happening on screen and suggest next actions.',
        format: `• What's on screen
• What it means
• Suggested action`,
    },
};

// ---------------------------------------------------------------------------
// ScreenScanLLM
// ---------------------------------------------------------------------------

export class ScreenScanLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Stream a context-aware analysis of the screen content.
     *
     * @param imagePaths  Screenshot image paths (required — at least 1)
     * @param extractedText  Optional OCR / heuristic text extracted from the image
     * @param forcedMode  Override auto-detection with an explicit mode
     */
    async *generateStream(
        imagePaths: string[],
        extractedText?: string,
        mode: ScreenContentMode = 'ui_general'
    ): AsyncGenerator<string> {
        if (!imagePaths || imagePaths.length === 0) {
            yield "No screenshot provided. Capture your screen and try again.";
            return;
        }

        try {
            const behavior = MODE_BEHAVIOR[mode];
            console.log(`[ScreenScanLLM] Mode detected: ${mode} (${behavior.label})`);

            // 1. Build user-facing message
            const message = buildScreenScanMessage(mode, extractedText ?? null);

            // 2. Stream from LLM with knowledge mode disabled.
            yield* this.llmHelper.streamChat(
                message,
                undefined,
                undefined,
                SCREEN_SCAN_PROMPT,
                true
            );
        } catch (error) {
            console.error("[ScreenScanLLM] Stream failed:", error);
            yield "I couldn't analyze the screen right now. Please try again.";
        }
    }
}
