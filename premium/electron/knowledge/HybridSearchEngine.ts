import { CompanyDossier, ContextNode, ScoredNode } from './types';
import { stableNodeKey } from './dedupeUtils';

export interface RelevanceOptions {
    sourceTypes?: string[];
    jdRequiredSkills?: string[];
    categoryHintKeywords?: string[];
    maxNodes?: number;
}

export function detectCategoryHints(question: string): string[] {
    const text = question.toLowerCase();
    const hints = new Set<string>();

    if (/(project|side project|portfolio)/.test(text)) hints.add('project');
    if (/(experience|work history|employment|role at)/.test(text)) hints.add('experience');
    if (/(education|degree|school|university|college)/.test(text)) hints.add('education');
    if (/(skill|stack|technology|tech stack|tools)/.test(text)) hints.add('skills');
    if (/(certification|certified|license)/.test(text)) hints.add('certification');
    if (/(leadership|managed|mentored|lead|manager)/.test(text)) hints.add('leadership');
    if (/(requirement|qualification|must have)/.test(text)) hints.add('jd_requirements');
    if (/(responsibilit|duties|you will)/.test(text)) hints.add('jd_responsibilities');
    if (/(compensation|salary|pay|offer|range)/.test(text)) hints.add('jd_compensation');
    if (/(company|employer|organization|team)/.test(text)) hints.add('jd_summary');

    return Array.from(hints);
}

function cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i += 1) {
        const av = a[i];
        const bv = b[i];
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function includesTerm(haystack: string, term: string): boolean {
    const t = term.trim().toLowerCase();
    if (!t || t.length < 2) return false;
    return haystack.includes(t);
}

const SCORE_SIMILARITY_WEIGHT = 0.7;
const SCORE_BOOST_WEIGHT = 0.3;

function getAdaptiveThreshold(question: string): number {
    const q = question.toLowerCase();

    if (q.includes('explain') || q.includes('why') || q.includes('how')) {
        return 0.25;
    }

    if (q.includes('salary') || q.includes('experience') || q.includes('skills')) {
        return 0.35;
    }

    return 0.3;
}

function normalizeScore(similarity: number, boost: number): number {
    return Math.min(
        1,
        (similarity * SCORE_SIMILARITY_WEIGHT) + (boost * SCORE_BOOST_WEIGHT)
    );
}

function computeBoost(
    text: string,
    node: ContextNode,
    requiredSkills: string[],
    categoryHints: string[],
    questionLower: string
): number {
    let boost = 0;

    if (requiredSkills.length > 0) {
        let matches = 0;
        for (const skill of requiredSkills) {
            if (includesTerm(text, skill)) matches += 1;
        }
        boost += Math.min(0.25, matches * 0.03);
    }

    if (categoryHints.length > 0) {
        for (const hint of categoryHints) {
            if (node.category === hint) {
                boost += 0.15;
            } else if (hint.startsWith('jd_') && node.category.startsWith('jd_')) {
                boost += 0.08;
            }
        }
    }

    if (questionLower.includes('salary') && node.category === 'jd_compensation') {
        boost += 0.2;
    }

    return boost;
}

function finalizeScoredNodes(scored: ScoredNode[], maxNodes: number, question: string): ScoredNode[] {
    const threshold = getAdaptiveThreshold(question);
    const filtered = scored
        .filter(n => n.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxNodes);

    if (!filtered.length) {
        return [];
    }

    return filtered;
}

function keywordSearchOnly(
    question: string,
    nodes: ContextNode[],
    requiredSkills: string[],
    categoryHints: string[],
    maxNodes: number
): ScoredNode[] {
    const questionLower = question.toLowerCase();
    const phrases = questionLower.split(/[.,?!]/).map(phrase => phrase.trim()).filter(Boolean);
    const questionTerms = new Set(
        questionLower
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .map(term => term.trim())
            .filter(term => term.length > 2)
    );
    const importantTerms = Array.from(questionTerms).filter(t => t.length > 4);

    const scored = nodes.map(node => {
        const text = `${node.title || ''} ${node.text_content || ''}`.toLowerCase();

        let phraseBoost = 0;
        for (const phrase of phrases) {
            if (text.includes(phrase)) {
                phraseBoost += 0.2;
            }
        }

        let weightedMatches = 0;
        for (const term of importantTerms) {
            if (text.includes(term)) weightedMatches += 2;
        }
        for (const term of questionTerms) {
            if (text.includes(term)) weightedMatches += 1;
        }
        const lexicalSimilarity = questionTerms.size > 0
            ? weightedMatches / (questionTerms.size * 2)
            : 0;
        const boost = computeBoost(text, node, requiredSkills, categoryHints, questionLower) + phraseBoost;
        return { node, score: normalizeScore(lexicalSimilarity, boost) };
    });

    return finalizeScoredNodes(scored, maxNodes, question);
}

export async function getRelevantNodes(
    _question: string,
    nodes: ContextNode[],
    _embedFn: (text: string) => Promise<number[]>,
    options: RelevanceOptions = {}
): Promise<ScoredNode[]> {
    const maxNodes = options.maxNodes ?? nodes.length;
    if (!nodes.length) return [];

    // Ensure input nodes are deduplicated by stable key before scoring.
    // Keep first-seen node for each stable key (deterministic, lightweight).
    try {
        const seen = new Set<string>();
        const deduped: ContextNode[] = [];
        for (const n of nodes) {
            const k = stableNodeKey(n) || '';
            if (!k) {
                // if key generation fails, include node conservatively
                deduped.push(n);
                continue;
            }
            if (!seen.has(k)) {
                seen.add(k);
                deduped.push(n);
            }
        }
        nodes = deduped;
    } catch {
        // If dedupe fails for any reason, fall back to original nodes.
    }

    const filteredNodes = options.sourceTypes && options.sourceTypes.length > 0
        ? nodes.filter(node => options.sourceTypes!.includes(node.source_type))
        : nodes;
    if (!filteredNodes.length) return [];

    const requiredSkills = options.jdRequiredSkills || [];
    const categoryHints = options.categoryHintKeywords || [];
    const questionLower = _question.toLowerCase();

    let questionEmbedding: number[] = [];
    try {
        questionEmbedding = await _embedFn(_question);
    } catch {
        questionEmbedding = [];
    }

    if (!questionEmbedding.length) {
        return keywordSearchOnly(_question, filteredNodes, requiredSkills, categoryHints, maxNodes);
    }

    const scored = filteredNodes.map(node => {
        const text = `${node.title || ''} ${node.text_content || ''}`.toLowerCase();
        const baseScore = node.embedding && questionEmbedding.length
            ? cosineSimilarity(questionEmbedding, node.embedding)
            : 0;

        const boost = computeBoost(text, node, requiredSkills, categoryHints, questionLower);

        return { node, score: normalizeScore(baseScore, boost) };
    });

    return finalizeScoredNodes(scored, maxNodes, _question);
}

export function formatDossierBlock(dossier: CompanyDossier | null): string {
    if (!dossier) return '';
    return JSON.stringify(dossier);
}

export function formatContextBlock(scoredNodes: ScoredNode[], maxNodes: number = 6): string {
    const sections: Record<string, string[]> = {
        EXPERIENCE: [],
        SKILLS: [],
        PROJECTS: [],
        EDUCATION: [],
        OTHER: []
    };

    const resolveSection = (category: string): keyof typeof sections => {
        const c = (category || '').toLowerCase();
        if (c.includes('experience')) return 'EXPERIENCE';
        if (c.includes('skill') || c.includes('tech')) return 'SKILLS';
        if (c.includes('project')) return 'PROJECTS';
        if (c.includes('education')) return 'EDUCATION';
        return 'OTHER';
    };

    scoredNodes
        .slice(0, maxNodes)
        .forEach(sn => {
            const text = (sn.node.text_content || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const section = resolveSection(sn.node.category);
            sections[section].push(`- ${text}`);
        });

    const sectionOrder: Array<keyof typeof sections> = ['EXPERIENCE', 'SKILLS', 'PROJECTS', 'EDUCATION', 'OTHER'];

    return sectionOrder
        .filter(section => sections[section].length > 0)
        .map(section => `[${section}]\n${sections[section].join('\n')}`)
        .join('\n\n');
}
