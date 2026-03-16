import { ContextNode, ScoredNode, DocType, CompanyDossier } from './types';

const RELEVANCE_THRESHOLD = 0.55;
const MAX_NODES = 8; // Support list-type queries that need multiple results

/**
 * Check if a node's end_date is recent (within 2 years of now).
 */
function isRecent(endDate: string | null): boolean {
    if (!endDate) return true; // Ongoing = recent
    try {
        const [year, month] = endDate.split('-').map(Number);
        const endMs = new Date(year, month - 1).getTime();
        const twoYearsAgo = Date.now() - (2 * 365.25 * 24 * 60 * 60 * 1000);
        return endMs >= twoYearsAgo;
    } catch {
        return false;
    }
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Extract keywords from a question for tag matching.
 */
function extractKeywords(question: string): string[] {
    return question.toLowerCase()
        .replace(/[^a-z0-9\s\-\.\/\+\#]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
}

/**
 * Map of query keywords to the resume node categories they should boost.
 */
const CATEGORY_KEYWORD_MAP: Record<string, string[]> = {
    'project': ['project'],
    'projects': ['project'],
    'built': ['project'],
    'build': ['project'],
    'education': ['education'],
    'degree': ['education'],
    'university': ['education'],
    'college': ['education'],
    'school': ['education'],
    'certification': ['certification'],
    'certifications': ['certification'],
    'certified': ['certification'],
    'achievement': ['achievement'],
    'achievements': ['achievement'],
    'award': ['achievement'],
    'awards': ['achievement'],
    'leadership': ['leadership'],
    'led': ['leadership', 'experience'],
    'managed': ['leadership', 'experience'],
    'skill': ['experience', 'project'],
    'skills': ['experience', 'project'],
    'experience': ['experience'],
    'worked': ['experience'],
    'role': ['experience'],
    'roles': ['experience'],
    'job': ['experience'],
    'jobs': ['experience'],
    'company': ['experience'],
    'companies': ['experience'],
};

/**
 * Detect which resume categories the question is asking about.
 */
export function detectCategoryHints(question: string): string[] {
    const qLower = question.toLowerCase();
    const boostedCategories = new Set<string>();
    for (const [keyword, categories] of Object.entries(CATEGORY_KEYWORD_MAP)) {
        if (qLower.includes(keyword)) {
            categories.forEach(c => boostedCategories.add(c));
        }
    }
    return Array.from(boostedCategories);
}

function scoreNode(
    node: ContextNode,
    questionEmbedding: number[],
    keywords: string[],
    rawQuestion: string,
    jdRequiredSkills?: string[],
    categoryHintKeywords?: string[]
): number {
    let score = 0;

    // 60% — Semantic similarity
    if (node.embedding && questionEmbedding.length > 0) {
        score += cosineSimilarity(node.embedding, questionEmbedding) * 0.6;
    }

    // 20% — Tag/keyword match
    if (keywords.some(k => node.tags.some(t => t.includes(k)))) {
        score += 0.2;
    }

    // 10% — Duration boost (if experience > 12 months)
    if (node.duration_months && node.duration_months > 12) {
        score += 0.1;
    }

    // 10% — Recency boost
    if (isRecent(node.end_date || null)) {
        score += 0.1;
    }

    // JD required skill boost: if this resume node matches a JD required skill, boost it
    if (jdRequiredSkills && jdRequiredSkills.length > 0 && node.source_type === DocType.RESUME) {
        const nodeText = node.text_content.toLowerCase();
        const nodeTags = node.tags.map(t => t.toLowerCase());
        for (const skill of jdRequiredSkills) {
            const skillLower = skill.toLowerCase();
            if (nodeText.includes(skillLower) || nodeTags.some(t => t.includes(skillLower))) {
                score += 0.15;
                break; // Only boost once per node
            }
        }
    }

    // Category boost: if the question targets a specific category (e.g. "projects"),
    // boost nodes of that category significantly
    if (categoryHintKeywords && categoryHintKeywords.length > 0 && node.source_type === DocType.RESUME) {
        if (categoryHintKeywords.includes(node.category)) {
            score += 0.25; // Strong boost for matching category
        }
    }

    // Title/name deep-dive boost: if the question mentions a specific project, role,
    // or organization name, strongly boost the matching node
    if (node.title && node.source_type === DocType.RESUME) {
        const questionLower = rawQuestion.toLowerCase();
        const titleLower = node.title.toLowerCase();
        const orgLower = (node.organization || '').toLowerCase();
        // Check if any meaningful part of the node title appears in the question
        // Split title into words and check for multi-word matches (>3 chars each)
        const titleWords = titleLower.split(/[\s,\-:@]+/).filter(w => w.length > 3);
        const matchingWords = titleWords.filter(w => questionLower.includes(w));
        if (matchingWords.length >= 2 || (titleWords.length === 1 && matchingWords.length === 1)) {
            score += 0.35; // Very strong boost for direct title mention
        }
        // Also check organization name
        if (orgLower.length > 3 && questionLower.includes(orgLower)) {
            score += 0.2;
        }
    }

    return score;
}

/**
 * Options for retrieval
 */
export interface SearchOptions {
    sourceTypes?: DocType[]; // Only retrieve nodes from these sources
    maxNodes?: number;
    threshold?: number;
    jdRequiredSkills?: string[]; // JD skills for boosting resume node relevance
    categoryHintKeywords?: string[]; // Resume categories to boost (e.g. ['project'] for project-related questions)
}

/**
 * Get the most relevant nodes for a given question.
 */
export async function getRelevantNodes(
    question: string,
    allNodes: ContextNode[],
    embedFn: (text: string) => Promise<number[]>,
    options: SearchOptions = {}
): Promise<ScoredNode[]> {
    const threshold = options.threshold || RELEVANCE_THRESHOLD;
    const maxNodes = options.maxNodes || MAX_NODES;

    let targetNodes = allNodes;
    if (options.sourceTypes && options.sourceTypes.length > 0) {
        targetNodes = allNodes.filter(n => options.sourceTypes!.includes(n.source_type));
    }

    if (targetNodes.length === 0) {
        return [];
    }

    // Generate embedding for the question
    let questionEmbedding: number[] = [];
    try {
        questionEmbedding = await embedFn(question);
    } catch (error: any) {
        console.warn('[HybridSearchEngine] Failed to embed question, falling back to keyword-only:', error.message);
    }

    const keywords = extractKeywords(question);

    // Score all nodes
    const scored: ScoredNode[] = targetNodes
        .map(node => ({
            node,
            score: scoreNode(node, questionEmbedding, keywords, question, options.jdRequiredSkills, options.categoryHintKeywords)
        }))
        .filter(n => n.score > threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxNodes);

    if (scored.length > 0) {
        console.log(`[HybridSearchEngine] Found ${scored.length} relevant nodes (top score: ${scored[0].score.toFixed(3)})`);
    } else {
        console.log(`[HybridSearchEngine] No nodes above relevance threshold (${threshold}) — no injection`);
    }

    return scored;
}

/**
 * Format relevant nodes into explicit context blocks, grouping resume nodes by category
 * so the LLM can distinguish between work experience, projects, education, and achievements.
 */
export function formatContextBlock(scoredNodes: ScoredNode[]): string {
    if (scoredNodes.length === 0) return '';

    const jdNodes = scoredNodes.filter(sn => sn.node.source_type === DocType.JD);

    // Group resume nodes by category
    const categoryGroups: Record<string, ScoredNode[]> = {};
    for (const sn of scoredNodes) {
        if (sn.node.source_type !== DocType.RESUME) continue;
        const cat = sn.node.category;
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(sn);
    }

    // Map categories to their XML tags and prefixes
    const categoryConfig: Record<string, { tag: string; prefix: (sn: ScoredNode) => string }> = {
        'experience': {
            tag: 'candidate_experience',
            prefix: (sn) => `[${sn.node.title} at ${sn.node.organization}]`
        },
        'star_story': {
            tag: 'candidate_experience',
            prefix: (sn) => `[STAR Story: ${sn.node.title}]`
        },
        'project': {
            tag: 'candidate_projects',
            prefix: (sn) => `[Project: ${sn.node.title}]`
        },
        'education': {
            tag: 'candidate_education',
            prefix: (sn) => `[Education: ${sn.node.title}]`
        },
        'achievement': {
            tag: 'candidate_achievements',
            prefix: (sn) => `[Achievement: ${sn.node.title}]`
        },
        'certification': {
            tag: 'candidate_certifications',
            prefix: (sn) => `[Certification: ${sn.node.title}]`
        },
        'leadership': {
            tag: 'candidate_leadership',
            prefix: (sn) => `[Leadership: ${sn.node.title}]`
        },
    };

    let blocks: string[] = [];

    // Merge categories that share the same XML tag
    const tagGroups: Record<string, { nodes: ScoredNode[]; getPrefix: (sn: ScoredNode) => string }[]> = {};
    for (const [cat, nodes] of Object.entries(categoryGroups)) {
        const config = categoryConfig[cat] || {
            tag: `candidate_${cat}`,
            prefix: (sn: ScoredNode) => `[${sn.node.category}: ${sn.node.title}]`
        };
        if (!tagGroups[config.tag]) tagGroups[config.tag] = [];
        tagGroups[config.tag].push({ nodes, getPrefix: config.prefix });
    }

    for (const [tag, groups] of Object.entries(tagGroups)) {
        const allNodes = groups.flatMap(g => g.nodes);
        const lines = allNodes.map((sn, i) => {
            const group = groups.find(g => g.nodes.includes(sn))!;
            return `${i + 1}. ${group.getPrefix(sn)} ${sn.node.text_content}`;
        });
        blocks.push(`<${tag}>\n${lines.join('\n')}\n</${tag}>`);
    }

    if (jdNodes.length > 0) {
        const jdLines = jdNodes.map((sn, i) => {
            return `${i + 1}. [${sn.node.category}] ${sn.node.text_content}`;
        });
        blocks.push(`<target_job_context>\n${jdLines.join('\n')}\n</target_job_context>`);
    }

    return blocks.join('\n\n');
}

/**
 * Format a company dossier into a context block for injection.
 */
export function formatDossierBlock(dossier: CompanyDossier | null): string {
    if (!dossier) return '';

    const lines: string[] = [];
    lines.push(`Company: ${dossier.company}`);

    if (dossier.hiring_strategy) {
        lines.push(`Hiring Strategy: ${dossier.hiring_strategy}`);
    }
    if (dossier.interview_focus) {
        lines.push(`Interview Focus: ${dossier.interview_focus}`);
    }
    if (dossier.salary_estimates && dossier.salary_estimates.length > 0) {
        const salaryLines = dossier.salary_estimates.map(s =>
            `  - ${s.title} in ${s.location}: ${s.currency} ${s.min.toLocaleString()}-${s.max.toLocaleString()} (confidence: ${s.confidence}, source: ${s.source || 'general knowledge'})`
        );
        lines.push(`Salary Estimates:\n${salaryLines.join('\n')}`);
    }
    if (dossier.competitors && dossier.competitors.length > 0) {
        lines.push(`Competitors: ${dossier.competitors.join(', ')}`);
    }
    if (dossier.recent_news) {
        lines.push(`Recent News: ${dossier.recent_news}`);
    }
    if (dossier.sources && dossier.sources.length > 0) {
        lines.push(`Sources: ${dossier.sources.join(', ')}`);
    }

    return `<company_research>\n${lines.join('\n')}\n</company_research>`;
}

