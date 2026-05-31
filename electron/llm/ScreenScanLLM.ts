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

function looksLikeCodingProblemStatement(text: string): boolean {
    const platformSignals = [
        /\bleetcode\b/i,
        /\bhackerrank\b/i,
        /\bcodeforces\b/i,
        /\bgeeksforgeeks\b/i,
    ];

    const problemSignals = [
        /\bexample\s*[0-9]+\b/i,
        /\bconstraints?\b/i,
        /\binput\b/i,
        /\boutput\b/i,
        /\bcompanies\b/i,
        /\bsubmissions?\b/i,
        /\baccepted\b/i,
        /\brelated topics\b/i,
        /\breturn\b/i,
        /\b1\s*<=\s*[a-z]/i,
        /\bthe test cases are generated\b/i,
        /\b(?:easy|medium|hard)\b/i,
    ];

    const titleSignals = [
        /\b\d{2,4}\.\s+[A-Z][A-Za-z0-9'(),\-/: ]+/,
        /\bproblem\s+\d{2,4}\b/i,
    ];

    const matchedPlatforms = countMatches(text, platformSignals);
    const matchedProblemSignals = countMatches(text, problemSignals);
    const matchedTitles = countMatches(text, titleSignals);

    return matchedTitles >= 1 || (matchedPlatforms >= 1 && matchedProblemSignals >= 2) || matchedProblemSignals >= 4;
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
    if (looksLikeCodingProblemStatement(normalized)) return 'coding';
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
        label: '⚡ Expert Code Analysis',
        objective: 'Detect the exact problem with its name/number, explain the optimal approach with complexity, and provide the complete working code solution.',
        format: `• Problem (name, number, platform)
• Approach (algorithm, complexity, why it works)
• Solution (complete code block)`,
    },
    interview_question: {
        label: '🎯 Interview Answer',
        objective: 'Identify the question type, explain what is being tested, and generate a complete, structured answer.',
        format: `• Problem / Question Type
• Explanation
• Approach / Strategy
• Complete Answer (speakable, first-person)`,
    },
    slides_presentation: {
        label: '📊 Slide Intelligence',
        objective: 'Summarize the slide content, extract data points, and generate talking points with questions.',
        format: `• Summary (2-3 sentences)
• Key Data Points
• Talking Points (with context)
• Questions to Ask`,
    },
    document_text: {
        label: '📄 Document Insights',
        objective: 'Extract and explain the most important insights with context and significance.',
        format: `• Document Type
• Key Insights (with context)
• Action Items
• Executive Summary`,
    },
    ui_general: {
        label: '🔍 Screen Analysis',
        objective: 'Explain what is happening on screen, provide context, and suggest next actions.',
        format: `• What's on screen
• Context & meaning
• Suggested actions
• Notable details`,
    },
};

// ---------------------------------------------------------------------------
// Signal Extraction — clean top-of-screen content for LLM consumption
// ---------------------------------------------------------------------------

/**
 * Extract the most relevant signal from raw OCR text.
 *
 * SIGNAL PRIORITY (Parakeet-critical):
 * 1. Filter out lines ≤ 20 chars — removes UI chrome noise (menu items, tab titles, icons)
 * 2. Take top 25 meaningful lines — problem statements live at the top of the screen
 * 3. Cap at 600 chars — clean, focused chunk instead of a noisy full OCR dump
 *
 * This dramatically reduces noise dominance and lets the LLM focus on the actual problem.
 */
function extractSignal(text: string): string {
    if (!text || !text.trim()) return '';
    const normalized = normalizeScreenText(text);
    return normalized
        .split('\n')
        .filter(line => line.trim().length > 20)  // kill short noise lines (menus, tabs, icons)
        .slice(0, 25)       // top meaningful portion — problem statement lives here
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 600)      // tight clean chunk — no token waste on noise
        .trim();
}

// ---------------------------------------------------------------------------
// OCR Quality Check — determines whether to use text or fall back to vision
// ---------------------------------------------------------------------------

/**
 * Heuristic to determine if OCR text is good enough to use.
 * If OCR is weak (too short, too garbled, low word density), Analyze Screen
 * should stop with a text warning instead of entering the vision route.
 */
function isGoodOCR(text: string | undefined): boolean {
    if (!text || !text.trim()) return false;

    const trimmed = text.trim();

    // Too short — likely just UI chrome or garbage
    if (trimmed.length < 40) return false;

    // Word count check — real content has words
    const words = trimmed.split(/\s+/).filter(w => w.length > 1);
    if (words.length < 8) return false;

    // Garble ratio — if too many non-alphanumeric chars, OCR is noisy
    const alphanumeric = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
    const ratio = alphanumeric / trimmed.length;
    if (ratio < 0.35) return false;

    return true;
}

// ---------------------------------------------------------------------------
// Context Prefix — boosts accuracy for coding problem screens
// ---------------------------------------------------------------------------

const CODING_CONTEXT_PREFIX = `Context:
- This is a coding problem screen (very likely LeetCode or HackerRank)
- OCR text may contain noise, UI artifacts, and broken words
- Focus ONLY on meaningful problem description and code
- Ignore menus, toolbars, and unrelated text
- Identify the exact problem and solve it confidently`;

const INTERVIEW_CONTEXT_PREFIX = `Context:
- This is an interview screen with a question visible
- OCR text may contain noise, UI artifacts, and broken words
- Focus ONLY on the question — ignore menus, toolbars, unrelated text
- Identify the exact question and solve it confidently`;


// ---------------------------------------------------------------------------
// Vision Fallback Prompt — used when OCR is too weak
// ---------------------------------------------------------------------------

const VISION_FALLBACK_PROMPT = `You are an expert coding interview assistant analyzing a screenshot.

OCR text extraction failed or was too noisy. You MUST rely on the screenshot image directly.

Use visual cues to identify the problem:
- Platform UI (LeetCode, HackerRank) — identify by layout
- Visible function signatures — infer problem from parameters
- Visible test cases/examples — reconstruct the problem

Your response must have three sections with bold headers:

Under "Problem:" — write the REAL problem name you identified from the screenshot (e.g., "Two Sum", "Valid Parentheses"). Include the platform and number if you can see them. Explain what the problem asks.

Under "Approach:" — explain the actual algorithm you will use. Name the data structure/technique. State time and space complexity.

Under "Solution:" — write the COMPLETE working code in a fenced code block. Real code that compiles and solves the problem. Not placeholders.

You must write REAL content. If you output placeholder text like "complete solution here" instead of actual code, you have failed.`;


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
     * Three critical upgrades:
     * 1. SIGNAL EXTRACTION — sends clean top-30-lines / 800-char chunk instead of raw OCR dump
     * 2. STRONG CONTEXT PREFIX — coding/interview prefix boosts problem identification accuracy
     * 3. TEXT-ONLY ROUTING — once OCR succeeds, images are not sent to the LLM
     *
     * @param imagePaths    Screenshot image paths (required — at least 1)
     * @param extractedText Optional OCR / heuristic text extracted from the image
     * @param mode          Content mode (auto-detected or forced)
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

            // Analyze Screen is OCR-first and text-only. Weak OCR must not
            // route into the screenshot/vision workflow.
            const isCodingMode = mode === 'coding' || mode === 'interview_question';

            if (!isGoodOCR(extractedText)) {
                console.log(`[ScreenScanLLM] OCR quality too low (${extractedText?.length ?? 0} chars) — not routing to vision`);
                yield "I couldn't detect enough readable text on screen. Try capturing a clearer area.";
                return;
            }

            // ── UPGRADE 1: SIGNAL EXTRACTION (Parakeet) ─────────────────
            // Filter noise, extract clean signal from meaningful lines only
            const signal = extractSignal(extractedText!);
            console.log(`[ScreenScanLLM] Signal extracted: ${signal.length} chars from ${extractedText!.length} chars OCR`);

            // ── UPGRADE 2: STRONG CONTEXT PREFIX ────────────────────────
            // Prepend context that tells the LLM what kind of screen this is
            let contextPrefix = '';
            if (mode === 'coding') {
                contextPrefix = CODING_CONTEXT_PREFIX;
            } else if (mode === 'interview_question') {
                contextPrefix = INTERVIEW_CONTEXT_PREFIX;
            }

            // ── UPGRADE 3: FORCE PROBLEM IDENTIFICATION FIRST ───────────
            // For coding/interview modes, inject an explicit "identify then solve"
            // instruction that dramatically improves problem identification accuracy.
            let message: string;
            if (isCodingMode && signal) {
                message = `${contextPrefix}

Extracted Content:
${signal}

Task:
Identify the exact problem (name and number if possible), explain your algorithm approach, then write the COMPLETE working code. Write real content — not template placeholders.`;
            } else {
                // Non-coding modes or no signal — use the standard message builder
                const baseMessage = buildScreenScanMessage(mode, signal || null);
                message = contextPrefix
                    ? `${contextPrefix}\n\n${baseMessage}`
                    : baseMessage;
            }

            // Stream from the selected model with OCR text only.
            yield* this.llmHelper.streamChat(
                message,
                undefined,
                undefined,
                SCREEN_SCAN_PROMPT,
                true               // ignore knowledge mode
            );
        } catch (error) {
            console.error("[ScreenScanLLM] Stream failed:", error);
            yield "I couldn't analyze the screen right now. Please try again.";
        }
    }
}
