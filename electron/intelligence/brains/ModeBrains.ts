import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { BrainId } from '../types';
import type { PromptInstruction } from '../../ActionContextBuilder';
import type { SubBrainInput, SubBrainExecutionResult, MergedInsightSet } from '../multibrain/types';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';
import { OutputMerger } from '../multibrain/OutputMerger';
import { createSubBrainRegistry } from '../multibrain/createMultiBrainLayer';
import { MultiBrainTelemetry } from '../multibrain/MultiBrainTelemetry';
import { ModeMemoryManager } from '../memory/ModeMemoryManager';
import { ExplainabilityIPC } from '../ipc/ExplainabilityIPC';

type ConfidenceLevel = 'high' | 'medium' | 'low';

type HeuristicText = {
    raw: string;
    normalized: string;
};

function buildCompactContract(input: BrainInput, lines: string[]): PromptInstruction {
    const maxWords = input.strategy.maxWords;
    return {
        key: 'output_contract',
        title: 'OUTPUT CONTRACT',
        content: [
            ...lines,
            `Keep the response under ${maxWords} words unless the user explicitly asked for more.`,
        ].join('\n'),
    };
}

function buildSignalInstruction(key: string, title: string, lines: string[]): PromptInstruction | null {
    const content = lines.filter(Boolean).join('\n').trim();
    if (!content) return null;
    return { key, title, content };
}

function getHeuristicText(input: BrainInput): HeuristicText {
    const raw = [
        input.userMessage,
        input.previousAnswer,
        input.analysis.answerShape,
        ...input.context.sources.slice(0, 5).map((source) => source.content),
    ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .slice(0, 12000);

    const normalized = raw
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    return { raw, normalized };
}

function countMatches(text: string, patterns: RegExp[]): number {
    return patterns.reduce((count, pattern) => {
        const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
        return count + (matches?.length ?? 0);
    }, 0);
}

function scoreToConfidence(strongSignals: number, weakSignals: number = 0): ConfidenceLevel {
    if (strongSignals >= 3 && weakSignals <= 1) return 'high';
    if (strongSignals >= 1) return 'medium';
    return 'low';
}

// ---------------------------------------------------------------------------
// Shared Multi-Brain Infrastructure
// ---------------------------------------------------------------------------

// Lazy-initialized shared instance (created once on first use)
let _subBrainRegistry: ReturnType<typeof createSubBrainRegistry> | null = null;

function getSubBrainRegistry(): ReturnType<typeof createSubBrainRegistry> {
    if (!_subBrainRegistry) {
        _subBrainRegistry = createSubBrainRegistry();
    }
    return _subBrainRegistry;
}

/**
 * Build SubBrainInput from the parent Brain's heuristic text.
 */
function buildSubBrainInput(input: BrainInput, modeId: string): SubBrainInput {
    const hText = getHeuristicText(input);
    return {
        rawText: hText.raw,
        normalizedText: hText.normalized,
        modeId,
    };
}

/** Max insights injected into the prompt — high-signal only */
const MAX_PROMPT_INSIGHTS = 2;
/** Minimum confidence for an insight to be injected into the prompt */
const PROMPT_CONFIDENCE_THRESHOLD = 0.75;
/** OutputMerger threshold — only quality insights survive merge */
const MERGE_CONFIDENCE_THRESHOLD = 0.3;

/**
 * Format the strongest merged insights as a PromptInstruction.
 *
 * Only injects the top MAX_PROMPT_INSIGHTS insights above
 * PROMPT_CONFIDENCE_THRESHOLD into the prompt. All remaining insights
 * stay as internal metadata (logged, not injected).
 *
 * Returns null if no insights meet the threshold.
 */
function mergedInsightsToInstruction(
    merged: MergedInsightSet,
    key: string,
    title: string,
): PromptInstruction | null {
    // Filter to high-confidence only, already sorted by OutputMerger
    const eligible = merged.insights.filter(i => i.confidence >= PROMPT_CONFIDENCE_THRESHOLD);
    const topInsights = eligible.slice(0, MAX_PROMPT_INSIGHTS);

    if (topInsights.length === 0) return null;

    const lines = topInsights.map(insight => {
        const conf = Math.round(insight.confidence * 100);
        const reasonStr = insight.reasoning.length > 0 ? ` (${insight.reasoning[0]})` : '';
        return `• ${insight.label} [${conf}% confidence]${reasonStr}`;
    });

    return {
        key,
        title,
        content: lines.join('\n'),
    };
}

/**
 * Run sub-brains synchronously for a mode, merge, and append
 * high-confidence insights as a PromptInstruction.
 *
 * Execution: sync for-loop with per-brain try/catch isolation.
 * Sub-brains are deterministic heuristics (<2ms each) — no async needed.
 *
 * Capability-gated: returns output unchanged if multiBrain is disabled.
 * Failure-safe: individual sub-brain errors never propagate.
 */
function runSubBrains(
    modeId: string,
    input: BrainInput,
    output: BrainOutput,
    instructionKey: string,
    instructionTitle: string,
    logPrefix: string,
): BrainOutput {
    if (!CapabilityRegistry.getInstance().isEnabled('multiBrain')) {
        return output;
    }

    try {
        const registry = getSubBrainRegistry();
        if (!registry.hasBrains(modeId)) return output;

        const subInput = buildSubBrainInput(input, modeId);
        const brains = registry.getBrains(modeId);

        // Sync execution with per-brain failure isolation
        const results: SubBrainExecutionResult[] = [];
        for (const brain of brains) {
            const startMs = performance.now();
            try {
                const brainOutput = brain.execute(subInput);
                results.push({
                    brainId: brain.id,
                    status: 'success',
                    output: brainOutput,
                    executionMs: Math.round((performance.now() - startMs) * 100) / 100,
                });
            } catch (err: unknown) {
                results.push({
                    brainId: brain.id,
                    status: 'failure',
                    error: err instanceof Error ? err.message : String(err),
                    executionMs: Math.round((performance.now() - startMs) * 100) / 100,
                });
            }
        }

        const merged = OutputMerger.merge(results, { confidenceThreshold: MERGE_CONFIDENCE_THRESHOLD });
        const instruction = mergedInsightsToInstruction(merged, instructionKey, instructionTitle);

        // --- Telemetry (capability-gated, non-blocking, silent) ---
        if (CapabilityRegistry.getInstance().isEnabled('multiBrainTelemetry')) {
            queueMicrotask(() => {
                try {
                    MultiBrainTelemetry.getInstance().recordBatch(results);
                } catch { /* telemetry failure is non-fatal */ }
            });
        }

        // --- Memory persistence (non-blocking, silent) ---
        // ModeMemoryManager.saveMemory() gates on 'modeMemory' capability
        // and enforces MIN_PERSIST_CONFIDENCE internally.
        if (merged.insights.length > 0) {
            queueMicrotask(() => {
                try {
                    const memory = ModeMemoryManager.getInstance();
                    for (const insight of merged.insights) {
                        memory.saveMemory({
                            modeId,
                            sourceBrain: instructionKey,
                            label: insight.label,
                            content: insight.reasoning.join('; '),
                            confidence: insight.confidence,
                            tags: [modeId],
                        });
                    }
                } catch { /* memory failure is non-fatal */ }
            });
        }

        // --- Explainability surface (capability-gated, non-blocking, silent) ---
        if (merged.insights.length > 0) {
            queueMicrotask(() => {
                try {
                    ExplainabilityIPC.getInstance().explainInsights(merged.insights, instructionKey);
                } catch { /* explainability failure is non-fatal */ }
            });
        }

        // Log all insights (including those below prompt threshold) for diagnostics
        if (merged.insights.length > 0) {
            console.log(
                `[${logPrefix}] Multi-brain: ${merged.brainCount} brains, ` +
                `${merged.insights.length} total insights, ` +
                `${instruction ? 'injecting top signals' : 'no signals above prompt threshold'}, ` +
                `${merged.totalExecutionMs}ms`,
            );
        }

        if (!instruction) return output;

        return {
            ...output,
            instructions: [...output.instructions, instruction],
        };
    } catch {
        // Multi-brain failure is completely silent — base output is unchanged
        return output;
    }
}

function buildSalesHeuristics(input: BrainInput): {
    confidence: ConfidenceLevel;
    primaryMove: string;
    signalLines: string[];
    contractLines: string[];
} {
    const text = getHeuristicText(input).normalized;

    const hesitation = countMatches(text, [
        /\bexpensive\b/i,
        /\btoo much\b/i,
        /\bmaybe later\b/i,
        /\bnot sure\b/i,
        /\bbudget\b/i,
        /\bhold off\b/i,
        /\bthink about it\b/i,
    ]);
    const pricing = countMatches(text, [
        /\bprice\b/i,
        /\bpricing\b/i,
        /\bcost\b/i,
        /\bdiscount\b/i,
        /\broi\b/i,
        /\bprocurement\b/i,
        /\bcommercial\b/i,
    ]);
    const urgency = countMatches(text, [
        /\burgent\b/i,
        /\basap\b/i,
        /\bthis quarter\b/i,
        /\bthis month\b/i,
        /\bdeadline\b/i,
        /\bneed by\b/i,
        /\bblocking\b/i,
        /\blaunch\b/i,
        /\btimeline\b/i,
    ]);
    const buyingSignals = countMatches(text, [
        /\bnext step\b/i,
        /\bproposal\b/i,
        /\bpilot\b/i,
        /\bsecurity review\b/i,
        /\blegal\b/i,
        /\bapproved\b/i,
        /\bsend over\b/i,
        /\bwhen can we\b/i,
        /\bmove forward\b/i,
    ]);
    const negativeSignals = countMatches(text, [
        /\bnot a priority\b/i,
        /\bno budget\b/i,
        /\balready using\b/i,
        /\bno need\b/i,
        /\btoo expensive\b/i,
        /\bcome back later\b/i,
    ]);
    const discoveryGaps = countMatches(text, [
        /\bpain\b/i,
        /\bproblem\b/i,
        /\bchallenge\b/i,
        /\bworkflow\b/i,
        /\bgoal\b/i,
        /\bprocess\b/i,
        /\bwhy now\b/i,
        /\bsuccess criteria\b/i,
    ]);

    const signalLines: string[] = [];
    if (hesitation > 0) signalLines.push(`Detected hesitation (${hesitation}): respond with acknowledge → reframe → next move.`);
    if (pricing > 0) signalLines.push(`Detected pricing pressure (${pricing}): lead with value, ROI, and packaging clarity before numbers.`);
    if (urgency > 0) signalLines.push(`Detected urgency/timeline (${urgency}): tighten the ask and propose a dated next step.`);
    if (buyingSignals > 0) signalLines.push(`Detected buying signals (${buyingSignals}): convert momentum into a concrete commitment.`);
    if (negativeSignals > 0) signalLines.push(`Detected deal risk (${negativeSignals}): de-risk carefully and avoid over-pitching.`);
    if (discoveryGaps > 0) signalLines.push(`Detected discovery opportunity (${discoveryGaps}): ask a pointed pain/impact question if the path is unclear.`);

    let primaryMove = 'discovery';
    if (pricing + hesitation >= Math.max(urgency, buyingSignals, discoveryGaps)) {
        primaryMove = pricing > 0 ? 'pricing_reframe' : 'objection_handling';
    } else if (buyingSignals > Math.max(pricing + hesitation, urgency, discoveryGaps)) {
        primaryMove = 'advance_commitment';
    } else if (urgency > Math.max(pricing + hesitation, buyingSignals, discoveryGaps)) {
        primaryMove = 'create_urgency';
    } else if (negativeSignals > 0 && negativeSignals >= buyingSignals) {
        primaryMove = 'deal_risk';
    }

    const confidence = scoreToConfidence(
        (hesitation > 0 ? 1 : 0)
        + (pricing > 0 ? 1 : 0)
        + (urgency > 0 ? 1 : 0)
        + (buyingSignals > 0 ? 1 : 0)
        + (negativeSignals > 0 ? 1 : 0),
        discoveryGaps === 0 ? 1 : 0,
    );

    const contractByMove: Record<string, string[]> = {
        objection_handling: [
            `Primary move: objection handling (${confidence} confidence).`,
            'Return exactly 4 compact lines: "Move:", "Say:", "Next:", and "Confidence:".',
            'The "Say:" line must validate the concern, reframe to value, and keep momentum.',
            `Use "Confidence: ${confidence}".`,
        ],
        pricing_reframe: [
            `Primary move: pricing reframe (${confidence} confidence).`,
            'Return exactly 4 compact lines: "Move:", "Say:", "Next:", and "Confidence:".',
            'The "Say:" line must anchor on business value or ROI before discussing price.',
            `Use "Confidence: ${confidence}".`,
        ],
        advance_commitment: [
            `Primary move: advance commitment (${confidence} confidence).`,
            'Return exactly 4 compact lines: "Move:", "Say:", "Next:", and "Confidence:".',
            'The "Next:" line must ask for a concrete commitment, owner, or meeting.',
            `Use "Confidence: ${confidence}".`,
        ],
        create_urgency: [
            `Primary move: create urgency (${confidence} confidence).`,
            'Return exactly 4 compact lines: "Move:", "Say:", "Next:", and "Confidence:".',
            'Use the live timeline or pain to justify acting now without sounding pushy.',
            `Use "Confidence: ${confidence}".`,
        ],
        deal_risk: [
            `Primary move: stabilize deal risk (${confidence} confidence).`,
            'Return exactly 4 compact lines: "Move:", "Say:", "Next:", and "Confidence:".',
            'Reduce friction, surface the real blocker, and avoid over-claiming.',
            `Use "Confidence: ${confidence}".`,
        ],
        discovery: [
            `Primary move: discovery (${confidence} confidence).`,
            'Return exactly 4 compact lines: "Move:", "Ask:", "Next:", and "Confidence:".',
            'The "Ask:" line must uncover pain, urgency, budget, or decision process.',
            `Use "Confidence: ${confidence}".`,
        ],
    };

    return {
        confidence,
        primaryMove,
        signalLines,
        contractLines: contractByMove[primaryMove] ?? contractByMove.discovery,
    };
}

function buildRecruitingHeuristics(input: BrainInput): {
    confidence: ConfidenceLevel;
    signalLines: string[];
    contractLines: string[];
} {
    const text = getHeuristicText(input).normalized;

    const ownershipSignals = countMatches(text, [
        /\bi owned\b/i,
        /\bi led\b/i,
        /\bi drove\b/i,
        /\bi was responsible\b/i,
        /\bi took initiative\b/i,
        /\bi started\b/i,
    ]);
    const leadershipSignals = countMatches(text, [
        /\bled\b/i,
        /\bmentored\b/i,
        /\binfluenced\b/i,
        /\baligned stakeholders\b/i,
        /\bcoordinated\b/i,
    ]);
    const measurableImpact = countMatches(text, [
        /\b\d+%\b/i,
        /\b\d+x\b/i,
        /\bincreased\b/i,
        /\breduced\b/i,
        /\bsaved\b/i,
        /\bimproved\b/i,
        /\bshipped\b/i,
        /\blaunched\b/i,
    ]);
    const initiativeSignals = countMatches(text, [
        /\bproactively\b/i,
        /\bproposed\b/i,
        /\bvolunteered\b/i,
        /\bcreated\b/i,
        /\bintroduced\b/i,
    ]);
    const vagueSignals = countMatches(text, [
        /\bkind of\b/i,
        /\bsort of\b/i,
        /\bstuff\b/i,
        /\bthings\b/i,
        /\bhelped with\b/i,
        /\bworked on\b/i,
    ]);
    const blameSignals = countMatches(text, [
        /\bnot my fault\b/i,
        /\bthey didn't\b/i,
        /\bmy manager\b/i,
        /\bother team\b/i,
        /\bwas blocked by them\b/i,
    ]);
    const starSignals = countMatches(text, [
        /\bsituation\b/i,
        /\btask\b/i,
        /\baction\b/i,
        /\bresult\b/i,
        /\boutcome\b/i,
    ]);

    const positiveScore = ownershipSignals + leadershipSignals + measurableImpact + initiativeSignals;
    const redFlagScore = vagueSignals + blameSignals;
    const confidence = scoreToConfidence(
        (positiveScore > 0 ? 1 : 0) + (measurableImpact > 0 ? 1 : 0) + (starSignals >= 2 ? 1 : 0),
        redFlagScore > 0 ? 0 : 1,
    );

    const signalLines: string[] = [];
    if (ownershipSignals > 0) signalLines.push(`Positive signal: ownership (${ownershipSignals}) surfaced.`);
    if (leadershipSignals > 0) signalLines.push(`Positive signal: leadership/influence (${leadershipSignals}) surfaced.`);
    if (measurableImpact > 0) signalLines.push(`Positive signal: measurable impact (${measurableImpact}) surfaced.`);
    if (initiativeSignals > 0) signalLines.push(`Positive signal: initiative (${initiativeSignals}) surfaced.`);
    if (starSignals >= 2) signalLines.push(`Behavioral structure: likely STAR evidence present (${starSignals}).`);
    if (vagueSignals > 0) signalLines.push(`Red flag: vague or low-specificity language (${vagueSignals}).`);
    if (blameSignals > 0) signalLines.push(`Red flag: blame-shifting or weak ownership (${blameSignals}).`);
    if (input.context.profileApplied) signalLines.push('Resume/profile context is available: use it to test alignment, not to assume fit.');

    const contractLines =
        redFlagScore > positiveScore
            ? [
                `Primary mode: candidate risk probe (${confidence} confidence).`,
                'Return exactly 4 compact lines: "Signal:", "Concern:", "Ask:", and "Confidence:".',
                'The "Ask:" line must be the best follow-up question to expose ownership, impact, or clarity.',
                `Use "Confidence: ${confidence}".`,
            ]
            : [
                `Primary mode: candidate evaluation (${confidence} confidence).`,
                'Return exactly 4 compact lines: "Signal:", "Strength:", "Ask:" or "Concern:", and "Confidence:".',
                'Reward ownership, leadership, measurable outcomes, and initiative. Penalize vagueness and blame-shifting.',
                `Use "Confidence: ${confidence}".`,
            ];

    return {
        confidence,
        signalLines,
        contractLines,
    };
}

function buildTeamMeetingHeuristics(input: BrainInput): {
    confidence: ConfidenceLevel;
    signalLines: string[];
    contractLines: string[];
} {
    const heuristicText = getHeuristicText(input);
    const text = heuristicText.normalized;
    const raw = heuristicText.raw;

    const decisionSignals = countMatches(text, [
        /\bwe'll\b/i,
        /\bwe will\b/i,
        /\bdecided\b/i,
        /\bgoing with\b/i,
        /\bplan is\b/i,
        /\blet's do\b/i,
        /\bagreed\b/i,
    ]);
    const blockerSignals = countMatches(text, [
        /\bwaiting on\b/i,
        /\bblocked by\b/i,
        /\bpending\b/i,
        /\bdependency\b/i,
        /\bcan't until\b/i,
        /\brisk\b/i,
        /\bstuck\b/i,
    ]);
    const ownerSignals = countMatches(raw, [
        /\b[A-Z][a-z]+\s+(?:will|owns?|can handle|is taking)\b/g,
        /\bI(?:'ll| will)\b/g,
        /\bwe(?:'ll| will)\b/g,
    ]);
    const deadlineSignals = countMatches(text, [
        /\bby friday\b/i,
        /\bby monday\b/i,
        /\bby eod\b/i,
        /\btomorrow\b/i,
        /\bnext week\b/i,
        /\bend of month\b/i,
        /\bdeadline\b/i,
    ]);
    const actionSignals = countMatches(text, [
        /\baction item\b/i,
        /\bfollow up\b/i,
        /\bneed to\b/i,
        /\bto do\b/i,
        /\bwill send\b/i,
        /\bwill handle\b/i,
    ]);

    const confidence = scoreToConfidence(
        (decisionSignals > 0 ? 1 : 0)
        + (blockerSignals > 0 ? 1 : 0)
        + (ownerSignals > 0 ? 1 : 0)
        + (deadlineSignals > 0 ? 1 : 0),
        actionSignals === 0 ? 1 : 0,
    );

    const signalLines: string[] = [];
    if (decisionSignals > 0) signalLines.push(`Decision language detected (${decisionSignals}).`);
    if (blockerSignals > 0) signalLines.push(`Blocker/risk language detected (${blockerSignals}).`);
    if (ownerSignals > 0) signalLines.push(`Ownership language detected (${ownerSignals}).`);
    if (deadlineSignals > 0) signalLines.push(`Deadline language detected (${deadlineSignals}).`);
    if (actionSignals > 0) signalLines.push(`Action-item language detected (${actionSignals}).`);

    const contractLines =
        blockerSignals >= Math.max(decisionSignals, actionSignals, ownerSignals)
            ? [
                `Primary mode: blocker capture (${confidence} confidence).`,
                'Return exactly 4 compact lines: "Decision:" or "Status:", "Action:", "Blocker:", and "Confidence:".',
                'The "Action:" line should include owner and deadline if present; otherwise say what is missing.',
                `Use "Confidence: ${confidence}".`,
            ]
            : [
                `Primary mode: meeting ops capture (${confidence} confidence).`,
                'Return exactly 4 compact lines: "Decision:", "Action:", "Owner:", and "Confidence:".',
                'If there is no explicit owner, say "Owner: unclear". If there is no explicit deadline, note it briefly in "Action:".',
                `Use "Confidence: ${confidence}".`,
            ];

    return {
        confidence,
        signalLines,
        contractLines,
    };
}

export class SalesBrain implements Brain {
    readonly id: BrainId = 'sales';
    readonly name = 'Sales Brain';
    readonly latencyTarget = 450;

    execute(input: BrainInput): BrainOutput {
        const heuristics = buildSalesHeuristics(input);
        const instructions: PromptInstruction[] = [
            {
                key: 'brain_directive',
                title: 'BRAIN: SALES',
                content: [
                    'You are a live sales copilot in an active customer conversation.',
                    'Think tactically: objection handling, discovery, pricing posture, negotiation leverage, deal momentum, and next-step control.',
                    'Do not answer generically. Choose the best move for the deal state that is visible right now.',
                    'When there is hesitation, acknowledge briefly, reframe to business value, and advance with a concrete ask.',
                    'When there is a buying signal, convert it into a commitment. When there is a discovery gap, ask a sharp question instead of pitching.',
                    'Be concise, tactical, and outcome-oriented. No consultant-speak, no long essays.',
                ].join('\n'),
            },
            buildSignalInstruction('live_sales_signals', 'LIVE SALES SIGNALS', [
                `Primary move inferred: ${heuristics.primaryMove}.`,
                ...heuristics.signalLines,
                `Signal confidence: ${heuristics.confidence}.`,
            ]),
            buildCompactContract(input, heuristics.contractLines),
        ].filter((instruction): instruction is PromptInstruction => instruction !== null);

        const baseOutput: BrainOutput = {
            instructions,
            outputContract: 'Sales response must identify the best tactical move, provide exact words or the best discovery ask, and include Confidence: high|medium|low.',
            streamStrategy: 'direct',
        };

        return this.appendSubBrainInsights(input, baseOutput);
    }

    /**
     * Run sales sub-brains synchronously and append high-confidence insights.
     * Capability-gated, failure-safe, prompt-bloat-safe.
     */
    private appendSubBrainInsights(input: BrainInput, output: BrainOutput): BrainOutput {
        return runSubBrains('sales', input, output, 'multi_brain_sales', 'MULTI-BRAIN SALES INSIGHTS', 'SalesBrain');
    }
}

export class LectureBrain implements Brain {
    readonly id: BrainId = 'lecture';
    readonly name = 'Lecture Brain';
    readonly latencyTarget = 420;

    execute(input: BrainInput): BrainOutput {
        return {
            instructions: [
                {
                    key: 'brain_directive',
                    title: 'BRAIN: LECTURE',
                    content: [
                        'Act as a live learning copilot.',
                        'Prioritize concept extraction, simpler explanations, question detection, and concise learning summaries.',
                        'When the transcript introduces a concept, explain it peer-to-peer and tie it to why it matters.',
                        'When the lecturer asks a question, produce the likely answer clearly and flag uncertainty instead of inventing.',
                        'Capture only study-worthy points; avoid noise.',
                    ].join('\n'),
                },
                buildCompactContract(input, [
                    'Return one of these shapes only: explanation, key takeaway, short summary, or answer to a class question.',
                    'Prefer 2-4 short sentences or up to 3 bullets.',
                    'Optimize for reading while listening.',
                ]),
            ],
            outputContract: 'Lecture response must simplify the live material or surface the most important learning signal.',
            streamStrategy: 'direct',
        };
    }
}

export class RecruitingBrain implements Brain {
    readonly id: BrainId = 'recruiting';
    readonly name = 'Recruiting Brain';
    readonly latencyTarget = 430;

    execute(input: BrainInput): BrainOutput {
        const heuristics = buildRecruitingHeuristics(input);
        const instructions: PromptInstruction[] = [
            {
                key: 'brain_directive',
                title: 'BRAIN: RECRUITING',
                content: [
                    'You are a live recruiting and hiring-manager copilot.',
                    'Evaluate signal, not vibes. Look for ownership, leadership, initiative, measurable outcomes, and role fit.',
                    'Treat vagueness, blame-shifting, weak impact, and poor clarity as recruiting risks that deserve a follow-up question.',
                    'If the candidate gives good evidence, say why it is strong. If the evidence is thin, identify the exact probe that would resolve uncertainty.',
                    'Be concise, analytical, and evidence-based. No generic interview coaching language.',
                ].join('\n'),
            },
            buildSignalInstruction('live_recruiting_signals', 'LIVE RECRUITING SIGNALS', [
                ...heuristics.signalLines,
                `Signal confidence: ${heuristics.confidence}.`,
            ]),
            buildCompactContract(input, heuristics.contractLines),
        ].filter((instruction): instruction is PromptInstruction => instruction !== null);

        const baseOutput: BrainOutput = {
            instructions,
            outputContract: 'Recruiting response must surface the strongest hiring signal or concern, propose the next best probe when needed, and include Confidence: high|medium|low.',
            streamStrategy: 'direct',
        };

        return this.appendSubBrainInsights(input, baseOutput);
    }

    /**
     * Run recruiting sub-brains synchronously and append high-confidence insights.
     * Capability-gated, failure-safe, prompt-bloat-safe.
     */
    private appendSubBrainInsights(input: BrainInput, output: BrainOutput): BrainOutput {
        return runSubBrains('recruiting', input, output, 'multi_brain_recruiting', 'MULTI-BRAIN RECRUITING INSIGHTS', 'RecruitingBrain');
    }
}

export class TeamMeetingBrain implements Brain {
    readonly id: BrainId = 'team_meeting';
    readonly name = 'Team Meeting Brain';
    readonly latencyTarget = 380;

    execute(input: BrainInput): BrainOutput {
        const heuristics = buildTeamMeetingHeuristics(input);
        const instructions: PromptInstruction[] = [
            {
                key: 'brain_directive',
                title: 'BRAIN: TEAM MEETING',
                content: [
                    'You are a live meeting-ops copilot.',
                    'Prioritize decisions, action items, blockers, owners, deadlines, and risk.',
                    'Compress the conversation into the operational truth: what was decided, who owns what, what is blocked, and what happens next.',
                    'If the user needs words to say, keep them first-person and practical. Otherwise prefer capture over commentary.',
                    'Do not generate fluffy recaps. If ownership or deadlines are missing, call that out explicitly.',
                ].join('\n'),
            },
            buildSignalInstruction('live_team_meeting_signals', 'LIVE TEAM MEETING SIGNALS', [
                ...heuristics.signalLines,
                `Signal confidence: ${heuristics.confidence}.`,
            ]),
            buildCompactContract(input, heuristics.contractLines),
        ].filter((instruction): instruction is PromptInstruction => instruction !== null);

        return {
            instructions,
            outputContract: 'Team meeting response must capture the operational outcome of the discussion and include Confidence: high|medium|low.',
            streamStrategy: 'direct',
        };
    }
}

export class LookingForWorkBrain implements Brain {
    readonly id: BrainId = 'looking_for_work';
    readonly name = 'Looking For Work Brain';
    readonly latencyTarget = 440;

    execute(input: BrainInput): BrainOutput {
        return {
            instructions: [
                {
                    key: 'brain_directive',
                    title: 'BRAIN: LOOKING FOR WORK',
                    content: [
                        'Act as a live job-search copilot.',
                        'Prioritize STAR responses, resume alignment, confidence coaching, and behavioral optimization.',
                        'Answer in first person, grounded in the candidate context already in the prompt.',
                        'For behavioral questions, make the situation, action, and measurable result unmistakable.',
                        'When the user is weak on a point, strengthen clarity and confidence without fabricating experience.',
                    ].join('\n'),
                },
                buildCompactContract(input, [
                    'Return one of these shapes only: polished interview answer, STAR-structured answer, resume-aligned story, or improvement advice.',
                    'Use one concise opening sentence followed by 2-4 supporting bullets or 2-4 short sentences.',
                    'Sound confident and human, not rehearsed.',
                ]),
            ],
            outputContract: 'Looking-for-work response must improve interview performance with first-person, role-aligned language.',
            streamStrategy: 'direct',
        };
    }
}
