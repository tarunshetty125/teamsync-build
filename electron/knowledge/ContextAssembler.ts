// electron/knowledge/ContextAssembler.ts
// Just-In-Time context building replacing static pre-computed personas

import { KnowledgeStatus, ScoredNode, DocType, KnowledgeDocument, StructuredResume, StructuredJD } from './types';
import { formatContextBlock } from './HybridSearchEngine';

export interface PromptAssemblyResult {
    systemPromptInjection: string;
    contextBlock: string;
    isIntroQuestion: boolean;
    introResponse?: string;
}

const INTRO_PATTERNS = [
    'introduce yourself',
    'tell me about yourself',
    'who are you',
    'what do you do',
    'describe yourself',
    'about yourself',
    'tell me who you are',
    'give me your introduction',
    'walk me through your background',
    'brief introduction',
    'self introduction'
];

/**
 * Checks if the user is asking an intro question.
 */
function isIntroQuestion(questionLower: string): boolean {
    return INTRO_PATTERNS.some(pattern => questionLower.includes(pattern));
}

/**
 * Build an identity header on-the-fly based on the active resume and active JD.
 */
function buildIdentityHeader(resumeDoc: KnowledgeDocument | null, jdDoc: KnowledgeDocument | null): string {
    if (!resumeDoc) return '';

    const resume = resumeDoc.structured_data as StructuredResume;
    const name = resume.identity.name;
    const role = resume.experience?.[0]?.role || 'Professional';

    const baseIdentity = `You are ${name}, a ${role}.`;
    let targetContext = '';
    let toneModifier = '';

    if (jdDoc) {
        const jd = jdDoc.structured_data as StructuredJD;
        const levelStr = jd.level ? jd.level.charAt(0).toUpperCase() + jd.level.slice(1) + '-level' : '';
        targetContext = ` You are currently interviewing for the ${levelStr} position of ${jd.title} at ${jd.company}.`;

        // Tone modifiers based on JD signals
        const kwLower = (jd.keywords || []).map((k: string) => k.toLowerCase()).join(' ');
        const descLower = (jd.description_summary || '').toLowerCase();
        const combined = kwLower + ' ' + descLower;

        if (combined.includes('startup') || combined.includes('fast-paced')) {
            toneModifier = ' Adopt a product-focused, pragmatic tone.';
        } else if (combined.includes('research') || combined.includes('academic')) {
            toneModifier = ' Adopt a detail-oriented, citation-friendly tone.';
        } else if (jd.level === 'staff' || jd.level === 'principal') {
            toneModifier = ' Adopt a leadership-focused, strategic tone.';
        } else if (jd.level === 'senior') {
            toneModifier = ' Adopt a concise, technically deep tone.';
        }
    }

    return `${baseIdentity}${targetContext}${toneModifier}`;
}

/**
 * Build the system prompt rules block.
 */
function buildKnowledgeSystemPrompt(identityHeader: string, hasJD: boolean): string {
    const baseRules = `- Always answer in first person.
- Never mention being an AI or copy-pasting from a resume.
- Use the provided context (Resume and/or JD) when relevant.
- Do not fabricate experience. If you lack direct experience, pivot to transferable skills or answer theoretically but confidently.`;

    const jdRules = hasJD ? `
- When giving company or compensation facts, cite sources in a "Sources" section at the end.
- If you present salary ranges or market data, include a confidence level (low/medium/high) and the source.
- Do not fabricate numbers, timelines, or projects.` : '';

    return `${identityHeader}

<knowledge_engine_rules>
${baseRules}${jdRules}
</knowledge_engine_rules>`;
}

/**
 * Generates an intro on the fly. 
 * This saves tokens relative to storing precomputed strings for every JD permutation.
 */
async function generateJitIntro(
    resumeDoc: KnowledgeDocument,
    jdDoc: KnowledgeDocument | null,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<string> {
    const resume = resumeDoc.structured_data as StructuredResume;
    let prompt = `Generate a highly professional, confident interview introduction (approx 120 words) for ${resume.identity.name}.`;

    if (jdDoc) {
        const jd = jdDoc.structured_data as StructuredJD;
        prompt += ` Tailor it slightly to align with the role of ${jd.title} at ${jd.company}, emphasizing overlapping skills.`;
    }

    prompt += `\n\nUse first person ("I am..."). No markdown. Output exactly what should be spoken aloud.`;
    prompt += `\n\nCandidate Details:\nRole: ${resume.experience?.[0]?.role}\nExperience: ${resume.experience.length} roles\nTop Skills: ${resume.skills.slice(0, 5).join(', ')}`;

    try {
        const response = await generateContentFn([{ text: prompt }]);
        return response.trim();
    } catch {
        // Fallback static intro if LLM fails
        return `Hi, I'm ${resume.identity.name}, and I currently work as a ${resume.experience?.[0]?.role}.`;
    }
}

/**
 * Assembles the final prompt context for the LLM based on user query.
 */
export async function assemblePromptContext(
    question: string,
    resumeDoc: KnowledgeDocument | null,
    jdDoc: KnowledgeDocument | null,
    relevantNodes: ScoredNode[],
    generateContentFn: ((contents: any[]) => Promise<string>) | null
): Promise<PromptAssemblyResult> {
    const questionLower = question.toLowerCase().trim();
    const isIntro = isIntroQuestion(questionLower);

    let introResponse = undefined;

    // Handle JIT Intro Generation
    if (isIntro && resumeDoc && generateContentFn) {
        console.log('[ContextAssembler] Generating Just-In-Time Intro...');
        introResponse = await generateJitIntro(resumeDoc, jdDoc, generateContentFn);
        return {
            systemPromptInjection: '',
            contextBlock: '',
            isIntroQuestion: true,
            introResponse
        };
    }

    // Assemble Knowledge Blocks for normal questions
    const contextBlock = formatContextBlock(relevantNodes);

    // Build the dynamic system prompt
    const identityHeader = buildIdentityHeader(resumeDoc, jdDoc);
    const systemPromptInjection = buildKnowledgeSystemPrompt(identityHeader, jdDoc !== null);

    return {
        systemPromptInjection,
        contextBlock,
        isIntroQuestion: false
    };
}
