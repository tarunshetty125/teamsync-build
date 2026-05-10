// electron/intelligence/resume/ResumeJDAnalyzer.ts
// Deterministic Resume × JD alignment analyzer.
//
// Takes raw resume text and JD text, extracts structured signals,
// and produces fit/gap reasoning. Used by ResumeBrain and BehavioralBrain
// to ground answers in real profile data aligned to the target role.
//
// This module:
//   ✅ Is synchronous and deterministic
//   ✅ Uses regex/keyword extraction only
//   ✅ Operates on existing profile/JD context
//   ❌ Does NOT call the LLM
//   ❌ Does NOT fetch new data
//   ❌ Does NOT create a new database
//   ❌ Does NOT rewrite retrieval

import type { QuestionCategory, BrainId } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FitSignal {
    /** The skill, technology, or quality that matches */
    readonly skill: string;
    /** Where it was found in the resume */
    readonly resumeEvidence: string;
    /** Where it was required in the JD */
    readonly jdEvidence: string;
    /** Match strength */
    readonly strength: 'strong' | 'moderate' | 'weak';
}

export interface ResumeJDAnalysis {
    /** Skills/experiences that strongly match JD requirements */
    readonly strongest_matches: FitSignal[];

    /** Skills the JD requires but resume doesn't clearly demonstrate */
    readonly missing_skills: string[];

    /** What the user should lead with in their answer */
    readonly suggested_emphasis: string[];

    /** Which projects from the resume are most relevant */
    readonly recommended_projects: string[];

    /** Human-readable fit reasoning string for prompt injection */
    readonly fit_reasoning: string;

    /** Confidence in the analysis (0–1) */
    readonly confidence: number;
}

export interface ResumeJDInput {
    /** The original question */
    question: string;

    /** Question category */
    category: QuestionCategory;

    /** Brain handling this question */
    brainId: BrainId;

    /** Raw resume/profile text (from profile intelligence) */
    resumeText?: string;

    /** Raw JD text (from profile intelligence or supplemental context) */
    jdText?: string;
}

// ---------------------------------------------------------------------------
// Skill extraction
// ---------------------------------------------------------------------------

/** Common tech skills and their normalized forms */
const SKILL_PATTERNS: Array<{ pattern: RegExp; normalized: string; category: 'language' | 'framework' | 'infra' | 'practice' | 'soft' }> = [
    // Languages
    { pattern: /\b(python|python3)\b/i, normalized: 'Python', category: 'language' },
    { pattern: /\b(javascript|js)\b/i, normalized: 'JavaScript', category: 'language' },
    { pattern: /\b(typescript|ts)\b/i, normalized: 'TypeScript', category: 'language' },
    { pattern: /\b(java)\b/i, normalized: 'Java', category: 'language' },
    { pattern: /\b(go|golang)\b/i, normalized: 'Go', category: 'language' },
    { pattern: /\b(rust)\b/i, normalized: 'Rust', category: 'language' },
    { pattern: /\b(c\+\+|cpp)\b/i, normalized: 'C++', category: 'language' },
    { pattern: /\b(c#|csharp)\b/i, normalized: 'C#', category: 'language' },
    { pattern: /\b(sql)\b/i, normalized: 'SQL', category: 'language' },

    // Frameworks / Libraries
    { pattern: /\b(react|react\.js|reactjs)\b/i, normalized: 'React', category: 'framework' },
    { pattern: /\b(next\.?js|nextjs)\b/i, normalized: 'Next.js', category: 'framework' },
    { pattern: /\b(node\.?js|nodejs)\b/i, normalized: 'Node.js', category: 'framework' },
    { pattern: /\b(express\.?js|expressjs|express)\b/i, normalized: 'Express', category: 'framework' },
    { pattern: /\b(django)\b/i, normalized: 'Django', category: 'framework' },
    { pattern: /\b(flask)\b/i, normalized: 'Flask', category: 'framework' },
    { pattern: /\b(spring boot|spring)\b/i, normalized: 'Spring', category: 'framework' },
    { pattern: /\b(angular)\b/i, normalized: 'Angular', category: 'framework' },
    { pattern: /\b(vue\.?js|vuejs|vue)\b/i, normalized: 'Vue', category: 'framework' },

    // Infrastructure
    { pattern: /\b(aws|amazon web services)\b/i, normalized: 'AWS', category: 'infra' },
    { pattern: /\b(gcp|google cloud)\b/i, normalized: 'GCP', category: 'infra' },
    { pattern: /\b(azure)\b/i, normalized: 'Azure', category: 'infra' },
    { pattern: /\b(docker)\b/i, normalized: 'Docker', category: 'infra' },
    { pattern: /\b(kubernetes|k8s)\b/i, normalized: 'Kubernetes', category: 'infra' },
    { pattern: /\b(redis)\b/i, normalized: 'Redis', category: 'infra' },
    { pattern: /\b(kafka)\b/i, normalized: 'Kafka', category: 'infra' },
    { pattern: /\b(postgres(?:ql)?|postgresql)\b/i, normalized: 'PostgreSQL', category: 'infra' },
    { pattern: /\b(mongo(?:db)?)\b/i, normalized: 'MongoDB', category: 'infra' },
    { pattern: /\b(mysql)\b/i, normalized: 'MySQL', category: 'infra' },
    { pattern: /\b(dynamodb)\b/i, normalized: 'DynamoDB', category: 'infra' },
    { pattern: /\b(elasticsearch|elastic)\b/i, normalized: 'Elasticsearch', category: 'infra' },
    { pattern: /\b(nginx)\b/i, normalized: 'Nginx', category: 'infra' },
    { pattern: /\b(terraform)\b/i, normalized: 'Terraform', category: 'infra' },
    { pattern: /\b(ci\/?cd|github actions|jenkins)\b/i, normalized: 'CI/CD', category: 'infra' },
    { pattern: /\b(graphql)\b/i, normalized: 'GraphQL', category: 'infra' },
    { pattern: /\b(rest(?:ful)?\s*api)\b/i, normalized: 'REST API', category: 'infra' },

    // Practices
    { pattern: /\b(microservices?)\b/i, normalized: 'Microservices', category: 'practice' },
    { pattern: /\b(system design)\b/i, normalized: 'System Design', category: 'practice' },
    { pattern: /\b(distributed systems?)\b/i, normalized: 'Distributed Systems', category: 'practice' },
    { pattern: /\b(agile|scrum)\b/i, normalized: 'Agile', category: 'practice' },
    { pattern: /\b(tdd|test[- ]?driven)\b/i, normalized: 'TDD', category: 'practice' },
    { pattern: /\b(devops)\b/i, normalized: 'DevOps', category: 'practice' },
    { pattern: /\b(machine learning|ml|deep learning)\b/i, normalized: 'Machine Learning', category: 'practice' },

    // Soft skills
    { pattern: /\b(leadership|lead|led)\b/i, normalized: 'Leadership', category: 'soft' },
    { pattern: /\b(mentor(?:ing|ship)?)\b/i, normalized: 'Mentorship', category: 'soft' },
    { pattern: /\b(cross[- ]?functional|collaboration)\b/i, normalized: 'Cross-functional Collaboration', category: 'soft' },
    { pattern: /\b(communication)\b/i, normalized: 'Communication', category: 'soft' },
];

/** Project name extraction pattern */
const PROJECT_PATTERN = /(?:(?:built|developed|created|designed|implemented|shipped|launched|led|managed|worked on|contributed to)\s+(?:a\s+|an\s+|the\s+)?)([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*){0,3}(?:\s+(?:platform|system|service|app|application|tool|engine|dashboard|api|pipeline|module))?)/gi;

function extractSkills(text: string): Set<string> {
    const skills = new Set<string>();
    for (const { pattern, normalized } of SKILL_PATTERNS) {
        if (pattern.test(text)) {
            skills.add(normalized);
        }
    }
    return skills;
}

function extractProjects(text: string): string[] {
    const projects: string[] = [];
    let match: RegExpExecArray | null;
    // Reset lastIndex for the global regex
    PROJECT_PATTERN.lastIndex = 0;
    while ((match = PROJECT_PATTERN.exec(text)) !== null) {
        const name = match[1]?.trim();
        if (name && name.length >= 3 && name.length <= 50) {
            projects.push(name);
        }
    }
    return [...new Set(projects)].slice(0, 8);
}

// ---------------------------------------------------------------------------
// Fit analysis
// ---------------------------------------------------------------------------

function buildFitSignals(resumeSkills: Set<string>, jdSkills: Set<string>): FitSignal[] {
    const signals: FitSignal[] = [];

    for (const skill of resumeSkills) {
        if (jdSkills.has(skill)) {
            signals.push({
                skill,
                resumeEvidence: `Found '${skill}' in resume`,
                jdEvidence: `Required '${skill}' in JD`,
                strength: 'strong',
            });
        }
    }

    return signals.sort((a, b) => {
        const strengthOrder: Record<string, number> = { strong: 3, moderate: 2, weak: 1 };
        return (strengthOrder[b.strength] ?? 0) - (strengthOrder[a.strength] ?? 0);
    });
}

function findMissingSkills(resumeSkills: Set<string>, jdSkills: Set<string>): string[] {
    const missing: string[] = [];
    for (const skill of jdSkills) {
        if (!resumeSkills.has(skill)) {
            missing.push(skill);
        }
    }
    return missing;
}

function buildSuggestedEmphasis(
    fitSignals: FitSignal[],
    projects: string[],
    category: QuestionCategory,
): string[] {
    const emphasis: string[] = [];

    // Lead with strongest matches
    const strongMatches = fitSignals.filter((s) => s.strength === 'strong').slice(0, 3);
    for (const match of strongMatches) {
        emphasis.push(`Emphasize ${match.skill} experience`);
    }

    // Suggest relevant projects
    if (projects.length > 0) {
        emphasis.push(`Lead with project: ${projects[0]}`);
    }

    // Category-specific emphasis
    if (category === 'behavioral') {
        emphasis.push('Frame with STAR: use measurable outcomes from real projects');
    } else if (category === 'resume_jd') {
        emphasis.push('Align experiences to JD requirements');
    }

    return emphasis;
}

function buildFitReasoning(
    fitSignals: FitSignal[],
    missingSkills: string[],
    projects: string[],
): string {
    const parts: string[] = [];

    if (fitSignals.length > 0) {
        const matchedSkills = fitSignals.map((s) => s.skill).join(', ');
        parts.push(`Strong matches: ${matchedSkills}.`);
    } else {
        parts.push('No direct skill matches found between resume and JD.');
    }

    if (missingSkills.length > 0) {
        parts.push(`Potential gaps: ${missingSkills.slice(0, 3).join(', ')}.`);
    }

    if (projects.length > 0) {
        parts.push(`Relevant projects: ${projects.slice(0, 3).join(', ')}.`);
    }

    return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze resume × JD alignment for a given question.
 *
 * This function is:
 *   - Synchronous
 *   - Deterministic
 *   - Realtime-safe (< 1ms)
 *   - Side-effect-free
 *
 * It operates on existing profile/JD text. It does NOT fetch new data.
 */
export function analyzeResumeJDFit(input: ResumeJDInput): ResumeJDAnalysis {
    const resumeText = input.resumeText ?? '';
    const jdText = input.jdText ?? '';

    // If neither resume nor JD is available, return empty analysis
    if (!resumeText && !jdText) {
        return {
            strongest_matches: [],
            missing_skills: [],
            suggested_emphasis: [],
            recommended_projects: [],
            fit_reasoning: 'No resume or JD context available.',
            confidence: 0.1,
        };
    }

    // Extract skills from both sources
    const resumeSkills = extractSkills(resumeText);
    const jdSkills = extractSkills(jdText);

    // Extract projects from resume
    const projects = extractProjects(resumeText);

    // Build fit/gap analysis
    const fitSignals = buildFitSignals(resumeSkills, jdSkills);
    const missingSkills = findMissingSkills(resumeSkills, jdSkills);
    const suggestedEmphasis = buildSuggestedEmphasis(fitSignals, projects, input.category);
    const fitReasoning = buildFitReasoning(fitSignals, missingSkills, projects);

    // Calculate confidence
    let confidence = 0.3;
    if (resumeText.length > 100) confidence += 0.15;
    if (jdText.length > 50) confidence += 0.15;
    if (fitSignals.length >= 2) confidence += 0.15;
    if (projects.length >= 1) confidence += 0.10;
    if (fitSignals.length >= 4) confidence += 0.10;
    confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

    return {
        strongest_matches: fitSignals,
        missing_skills: missingSkills,
        suggested_emphasis: suggestedEmphasis,
        recommended_projects: projects,
        fit_reasoning: fitReasoning,
        confidence,
    };
}

/**
 * Check whether a resume/JD analysis has enough data to be useful.
 */
export function isAnalysisUsable(analysis: ResumeJDAnalysis): boolean {
    return analysis.confidence >= 0.4 && (analysis.strongest_matches.length > 0 || analysis.recommended_projects.length > 0);
}
