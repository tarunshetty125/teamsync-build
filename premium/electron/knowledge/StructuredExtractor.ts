import { DashboardExtractionResult, DocType, StructuredJD, StructuredResume } from './types';
import { stableProjectKey, stableEducationKey } from './dedupeUtils';

type JsonValue = Record<string, any> | any[];

function extractJsonPayload(raw: string): string {
    let text = raw.trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        text = fenced[1].trim();
    }
    text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return text.slice(firstBrace, lastBrace + 1);
    }
    return text;
}

function parseJson(raw: string): JsonValue {
    const cleaned = extractJsonPayload(raw);
    return JSON.parse(cleaned) as JsonValue;
}

/**
 * Fail-safe JSON parser — NEVER crashes pipeline.
 * Returns null on any parse failure instead of throwing.
 */
function safeParse(raw: string): JsonValue | null {
    try {
        return parseJson(raw);
    } catch {
        return null;
    }
}

function toString(value: any): string {
    return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => toString(item)).filter(Boolean);
}

function normalizeCompanyCandidate(value: string): string {
    const cleaned = value.trim().replace(/^[\-–•\s]+/, '').replace(/[\s,;:.]+$/, '');
    if (!cleaned) return '';
    if (cleaned.length > 80) return '';
    const lower = cleaned.toLowerCase();
    if (lower.includes('job description') || lower.includes('responsibilities')) return '';
    return cleaned;
}

function normalizeTitleCandidate(value: string): string {
    const cleaned = value.trim().replace(/^[\-–•\s]+/, '').replace(/[\s,;:.]+$/, '');
    if (!cleaned) return '';
    if (cleaned.length > 120) return '';
    const lower = cleaned.toLowerCase();
    if (lower.includes('job description') || lower.includes('responsibilities')) return '';
    return cleaned;
}

function normalizeLocationCandidate(value: string): string {
    const cleaned = value.trim().replace(/^[\-–•\s]+/, '').replace(/[\s,;:.]+$/, '');
    if (!cleaned) return '';
    if (cleaned.length > 120) return '';
    return cleaned;
}

function inferCompanyFromText(rawText: string): string {
    const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const scanLines = lines.slice(0, 40);
    const directPatterns = [
        /^(?:company|employer|organization|about)\s*[:\-]\s*(.+)$/i,
        /^about\s+(.+)$/i,
        /^at\s+(.+)$/i,
    ];

    for (const line of scanLines) {
        for (const pattern of directPatterns) {
            const match = line.match(pattern);
            if (match?.[1]) {
                const candidate = normalizeCompanyCandidate(match[1]);
                if (candidate) return candidate;
            }
        }
    }

    const inlineMatch = rawText.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.,'\-\s]{2,60})/);
    if (inlineMatch?.[1]) {
        const candidate = normalizeCompanyCandidate(inlineMatch[1]);
        if (candidate) return candidate;
    }

    return '';
}

function inferTitleFromText(rawText: string): string {
    const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const scanLines = lines.slice(0, 40);
    const directPatterns = [
        /^(?:title|role|position|job title)\s*[:\-]\s*(.+)$/i,
        /^(?:we are hiring|hiring for|seeking|looking for)\s+(.+)$/i
    ];

    for (const line of scanLines) {
        for (const pattern of directPatterns) {
            const match = line.match(pattern);
            if (match?.[1]) {
                const candidate = normalizeTitleCandidate(match[1]);
                if (candidate) return candidate;
            }
        }
    }

    return '';
}

function inferLocationFromText(rawText: string): string {
    const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const scanLines = lines.slice(0, 50);
    const directPatterns = [
        /^(?:location)\s*[:\-]\s*(.+)$/i,
        /^(?:based in|location is)\s+(.+)$/i
    ];

    for (const line of scanLines) {
        for (const pattern of directPatterns) {
            const match = line.match(pattern);
            if (match?.[1]) {
                const candidate = normalizeLocationCandidate(match[1]);
                if (candidate) return candidate;
            }
        }
        if (/\bremote\b/i.test(line)) return 'Remote';
        if (/\bhybrid\b/i.test(line)) return 'Hybrid';
        if (/\bon[-\s]?site\b/i.test(line)) return 'On-site';
    }

    return '';
}

async function inferJDFieldsWithLLM(
    rawText: string,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<{ company: string; title: string; location: string }> {
    const prompt = [
        'You are extracting key fields from a job description.',
        'Return ONLY valid JSON. No markdown, no commentary.',
        'Schema:',
        '{ "company": "", "title": "", "location": "" }',
        'Rules:',
        '- If a field is not found, return empty string.',
        '- Do not guess. Use the JD text only.',
        'Job description text:',
        rawText.slice(0, 4000)
    ].join('\n');

    try {
        const rawResponse = await generateContentFn([{ text: prompt }]);
            let parsed: any;
            try {
                parsed = parseJson(rawResponse);
            } catch (err: any) {
                console.error('[StructuredExtractor] LLM JSON parse failed:', err?.message || err);
                parsed = {};
            }
        return {
            company: toString(parsed?.company),
            title: toString(parsed?.title),
            location: toString(parsed?.location)
        };
    } catch {
        return { company: '', title: '', location: '' };
    }
}

function normalizeResume(data: any): StructuredResume {
    const identity = data?.identity ?? {};
    const experience = Array.isArray(data?.experience) ? data.experience : [];
    const projects = Array.isArray(data?.projects) ? data.projects : [];
    const education = Array.isArray(data?.education) ? data.education : [];
    const achievements = Array.isArray(data?.achievements) ? data.achievements : [];
    const certifications = Array.isArray(data?.certifications) ? data.certifications : [];
    const leadership = Array.isArray(data?.leadership) ? data.leadership : [];

    return {
        identity: {
            name: toString(identity.name),
            email: toString(identity.email),
            phone: toString(identity.phone),
            location: toString(identity.location),
            linkedin: toString(identity.linkedin),
            github: toString(identity.github),
            website: toString(identity.website),
            summary: toString(identity.summary),
        },
        skills: toStringArray(data?.skills),
        experience: experience.map((item: any) => ({
            company: toString(item?.company),
            role: toString(item?.role),
            start_date: toString(item?.start_date),
            end_date: item?.end_date === null ? null : toString(item?.end_date) || null,
            bullets: toStringArray(item?.bullets),
        })),
        projects: projects
            .map((item: any) => {
                const technologies = normalizeSkillList(item?.technologies);
                return {
                    name: normalizeProjectTitle(item?.name),
                    description: sanitizeProjectDescription(item?.description, technologies),
                    technologies,
                    url: toString(item?.url),
                };
            })
            .filter((item: any) => item.name || item.description || item.technologies.length > 0),
        education: education.map((item: any) => ({
            institution: toString(item?.institution),
            degree: toString(item?.degree),
            field: toString(item?.field),
            start_date: toString(item?.start_date),
            end_date: item?.end_date === null ? null : toString(item?.end_date) || null,
            gpa: toString(item?.gpa),
        })),
        achievements: achievements.map((item: any) => ({
            title: toString(item?.title),
            description: toString(item?.description),
            date: toString(item?.date),
        })),
        certifications: certifications.map((item: any) => ({
            name: toString(item?.name),
            issuer: toString(item?.issuer),
            date: toString(item?.date),
        })),
        leadership: leadership.map((item: any) => ({
            role: toString(item?.role),
            organization: toString(item?.organization),
            description: toString(item?.description),
        })),
    };
}

function normalizeJD(data: any): StructuredJD {
    const levelRaw = toString(data?.level);
    const employmentRaw = toString(data?.employment_type);
    const level = (['intern', 'entry', 'mid', 'senior', 'staff', 'principal'] as const).includes(levelRaw as any)
        ? (levelRaw as StructuredJD['level'])
        : 'mid';
    const employment_type = (['full_time', 'part_time', 'contract', 'internship'] as const).includes(employmentRaw as any)
        ? (employmentRaw as StructuredJD['employment_type'])
        : 'full_time';

    const minYears = Number.isFinite(Number(data?.min_years_experience))
        ? Number(data.min_years_experience)
        : 0;

    return {
        title: toString(data?.title),
        company: toString(data?.company),
        location: toString(data?.location),
        description_summary: toString(data?.description_summary),
        level,
        employment_type,
        min_years_experience: minYears,
        compensation_hint: toString(data?.compensation_hint),
        requirements: toStringArray(data?.requirements),
        nice_to_haves: toStringArray(data?.nice_to_haves),
        responsibilities: toStringArray(data?.responsibilities),
        technologies: toStringArray(data?.technologies),
        keywords: toStringArray(data?.keywords),
    };
}

function buildResumePrompt(rawText: string): string {
    return [
        'You are a resume parser.',
        'Return ONLY valid JSON. No markdown, no commentary.',
        'Schema:',
        '{',
        '  "identity": { "name": "", "email": "", "phone": "", "location": "", "linkedin": "", "github": "", "website": "", "summary": "" },',
        '  "skills": [""],',
        '  "experience": [{ "company": "", "role": "", "start_date": "YYYY-MM", "end_date": "YYYY-MM or null", "bullets": [""] }],',
        '  "projects": [{ "name": "", "description": "", "technologies": [""], "url": "" }],',
        '  "education": [{ "institution": "", "degree": "", "field": "", "start_date": "YYYY-MM", "end_date": "YYYY-MM or null", "gpa": "" }],',
        '  "achievements": [{ "title": "", "description": "", "date": "" }],',
        '  "certifications": [{ "name": "", "issuer": "", "date": "" }],',
        '  "leadership": [{ "role": "", "organization": "", "description": "" }]',
        '}',
        'Rules:',
        '- Use empty strings for unknown scalar fields, empty arrays for missing lists.',
        '- Convert dates to YYYY-MM when possible; otherwise use the original string.',
        '- Keep bullets concise.',
        'Resume text:',
        rawText
    ].join('\n');
}

function buildJDPrompt(rawText: string): string {
    return [
        'You are a job description parser.',
        'Return ONLY valid JSON. No markdown, no commentary.',
        'Schema:',
        '{',
        '  "title": "",',
        '  "company": "",',
        '  "location": "",',
        '  "description_summary": "",',
        '  "level": "intern|entry|mid|senior|staff|principal",',
        '  "employment_type": "full_time|part_time|contract|internship",',
        '  "min_years_experience": 0,',
        '  "compensation_hint": "",',
        '  "requirements": [""],',
        '  "nice_to_haves": [""],',
        '  "responsibilities": [""],',
        '  "technologies": [""],',
        '  "keywords": [""]',
        '}',
        'Rules:',
        '- Use empty strings for unknown scalar fields, empty arrays for missing lists.',
        '- If level/employment type is not specified, use "mid" and "full_time".',
        '- min_years_experience must be a number (0 if unknown).',
        'Job description text:',
        rawText
    ].join('\n');
}

function inferSkillsFromText(rawText: string): string[] {
    const lower = rawText.toLowerCase();
    const dictionary = [
        'javascript', 'typescript', 'react', 'node', 'node.js', 'express', 'next.js',
        'python', 'java', 'golang', 'c++', 'c#', 'ruby', 'rust', 'swift', 'kotlin',
        'sql', 'postgresql', 'mysql', 'mongodb', 'sqlite', 'cassandra', 'dynamodb',
        'redis', 'graphql', 'rest', 'aws', 'azure', 'gcp', 'docker', 'kubernetes',
        'git', 'ci/cd', 'html', 'css', 'tailwind', 'vite', 'electron', 'jest',
        'terraform', 'ansible', 'jenkins', 'kafka', 'rabbitmq', 'nginx', 'linux',
        'flask', 'django', 'spring', 'angular', 'vue', 'svelte', 'flutter', 'dart',
        'pytorch', 'tensorflow', 'scikit-learn', 'pandas', 'numpy', 'opencv',
        'firebase', 'supabase', 'prisma', 'sequelize', 'typeorm',
        'figma', 'sketch', 'jira', 'confluence', 'agile', 'scrum',
        'machine learning', 'deep learning', 'nlp', 'computer vision',
        'microservices', 'serverless', 'websocket', 'grpc',
        'php', 'jwt', 'ejs', 'handlebars', 'pug', 'sass', 'less',
        'webpack', 'babel', 'rollup', 'esbuild', 'parcel',
        'mocha', 'chai', 'cypress', 'playwright', 'puppeteer',
        'heroku', 'vercel', 'netlify', 'cloudflare',
        'three.js', 'socket.io', 'rxjs', 'd3', 'chart.js',
        'spring boot', 'hibernate', 'maven', 'gradle',
        'celery', 'airflow', 'spark', 'hadoop',
        'elastic', 'elasticsearch', 'kibana', 'grafana', 'prometheus',
        'openai', 'langchain', 'huggingface',
        'material ui', 'chakra ui', 'styled-components',
        'stripe', 'twilio', 'sendgrid',
        'nosql', 'orm', 'api', 'oauth', 'auth0'
    ];

    const found = new Set<string>();
    for (const skill of dictionary) {
        const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\/', '/');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(lower)) {
            found.add(skill === 'node.js' ? 'node' : skill);
        }
    }

    return Array.from(found);
}

/**
 * Deterministic skills extractor — works WITHOUT LLM.
 * Uses the comprehensive inferSkillsFromText dictionary + normalizes.
 * This is the PRIMARY extraction path; LLM only supplements.
 */
function extractSkillsFromText(text: string): string[] {
    if (!text) return [];
    const raw = inferSkillsFromText(text);
    const normalized = Array.from(new Set(raw.map(s => normalizeSkillName(s)))).filter(Boolean);
    return normalized.slice(0, 15);
}

/**
 * Deterministic project extractor — works WITHOUT LLM.
 * Delegates to the existing inferProjectsFromResumeText function.
 */
function extractProjectsFromText(text: string): DashboardExtractionResult['projects'] {
    if (!text) return [];

    // Split into blocks separated by one or more blank lines
    const blocks = String(text).split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

    const normalize = (s?: any) => toString(s).toLowerCase().replace(/\s+/g, ' ').trim();
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return blocks
        .filter(block => /project|application|system/i.test(block))
        .map(block => {
            const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const firstLine = lines[0] || '';

            // Always treat the first line as the title (cleaned below)
            let rawTitle = firstLine;
            let inlineDesc = '';

            // Handle inline "Title - description" but only split on the FIRST separator
            const sepIndex = firstLine.indexOf(' - ');
            if (sepIndex >= 0) {
                rawTitle = firstLine.slice(0, sepIndex).trim();
                inlineDesc = firstLine.slice(sepIndex + 3).trim();
            }

            // Remaining lines are the rest of the description (multi-line format)
            const restLines = lines.slice(1).join('\n').trim();

            // Build description deterministically and avoid duplication between inline and rest
            let descriptionCandidate = '';
            if (inlineDesc && restLines) {
                const nInline = normalize(inlineDesc);
                const nRest = normalize(restLines);
                if (nRest.includes(nInline)) {
                    // rest already contains inline description — prefer rest (more complete)
                    descriptionCandidate = restLines;
                } else if (nInline.includes(nRest)) {
                    descriptionCandidate = inlineDesc;
                } else {
                    descriptionCandidate = `${inlineDesc}\n${restLines}`;
                }
            } else if (inlineDesc) {
                descriptionCandidate = inlineDesc;
            } else if (restLines) {
                descriptionCandidate = restLines;
            } else {
                // No explicit description; use block minus the first line to avoid repeating title
                const fallback = block.replace(new RegExp('^' + escapeRegExp(firstLine), 'i'), '').trim();
                descriptionCandidate = fallback ? fallback.slice(0, 200) : '';
            }

            // Remove leading duplication of the title in the description (if present)
            if (descriptionCandidate) {
                const nTitle = normalize(rawTitle);
                const nDesc = normalize(descriptionCandidate);
                if (nTitle && nDesc.startsWith(nTitle)) {
                    // Remove the title (and any following separators) from the start of description
                    const re = new RegExp('^\\s*' + escapeRegExp(rawTitle) + '[\\s:\\-–—]*', 'i');
                    descriptionCandidate = descriptionCandidate.replace(re, '').trim();
                }
            }

            const technologies = extractSkillsFromText(block) || [];
            const uniqTech = Array.from(new Set(technologies)).slice(0, 5);
            const normalizedTitle = normalizeProjectTitle(rawTitle);
            const normalizedDescription = sanitizeProjectDescription(descriptionCandidate, uniqTech);

            return {
                title: normalizedTitle,
                description: normalizedDescription,
                technologies: uniqTech,
                extraCount: Math.max(0, technologies.length - uniqTech.length),
            } as DashboardExtractionResult['projects'][number];
        })
        .filter(project => project.title || project.description || project.technologies.length > 0)
        .slice(0, 2);
}

/**
 * Deterministic education extractor — works WITHOUT LLM.
 * Delegates to the existing inferAcademicBackgroundFromResumeText + dedup + garbage filter.
 */
function extractEducationFromText(text: string): DashboardExtractionResult['education'] {
    if (!text) return [];
    const raw = inferAcademicBackgroundFromResumeText(text);
    return blockGarbageEducation(dedupeEducation(raw));
}

/**
 * Deterministic match score calculator.
 * - If NO JD text at all → returns null.
 * - If JD text exists but no skills could be extracted → fallback 50 (NEVER null).
 * - Otherwise computes intersection(resumeSkills, jdSkills) coverage.
 *
 * KEY FIX: When jdSkills is empty but jdText exists, we attempt to extract
 * skills from jdText on-the-fly so match score is ALWAYS computed when JD is present.
 */
function computeMatchScore({ resumeSkills, jdSkills, jdText }: { resumeSkills: string[]; jdSkills: string[]; jdText?: string }): number | null {
    // If JD text truly missing, matchScore = null per spec
    if (!jdText || !jdText.trim()) return null;

    // If passed jdSkills are empty, try extracting from jdText directly
    let effectiveJdSkills = Array.isArray(jdSkills) && jdSkills.length > 0 ? jdSkills : [];
    if (effectiveJdSkills.length === 0) {
        effectiveJdSkills = inferSkillsFromText(jdText);
    }

    // If JD present but still no skills detected, return neutral baseline (NEVER null)
    if (effectiveJdSkills.length === 0) return 50;

    const resumeSet = new Set((resumeSkills || []).map(normalizeSkill));
    const matched = effectiveJdSkills.filter(j => resumeSet.has(normalizeSkill(j)));
    const coverage = matched.length / effectiveJdSkills.length;
    // Non-linear scoring to reflect recruiter perception
    const score = Math.pow(coverage, 0.7) * 100;
    return Math.round(score);
}

const SKILL_CANONICAL_MAP: Record<string, string> = {
    'nodejs': 'Node.js',
    'node.js': 'Node.js',
    'node': 'Node.js',
    'reactjs': 'React',
    'react.js': 'React',
    'js': 'JavaScript',
    'javascript': 'JavaScript',
    'ts': 'TypeScript',
    'typescript': 'TypeScript',
    'golang': 'Go',
    'mongo': 'MongoDB',
    'mongodb': 'MongoDB',
    'postgres': 'PostgreSQL',
    'postgresql': 'PostgreSQL',
    'aws': 'AWS',
    'gcp': 'GCP',
    'ci/cd': 'CI/CD',
    'rest': 'REST',
    'rest api': 'REST',
    'restful api': 'REST',
    'nextjs': 'Next.js',
    'next.js': 'Next.js',
    'html5': 'HTML',
    'css3': 'CSS',
};

const DEGREE_NORMALIZATION: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /^bca$/i, value: 'Bachelor of Computer Application' },
    { pattern: /^mca$/i, value: 'Master of Computer Application' },
    { pattern: /^b\.?tech$/i, value: 'Bachelor of Technology' },
    { pattern: /^m\.?tech$/i, value: 'Master of Technology' },
    { pattern: /^b\.?e\.?$/i, value: 'Bachelor of Engineering' },
    { pattern: /^m\.?e\.?$/i, value: 'Master of Engineering' },
    { pattern: /^b\.?sc$/i, value: 'Bachelor of Science' },
    { pattern: /^m\.?sc$/i, value: 'Master of Science' },
    { pattern: /^b\.?a$/i, value: 'Bachelor of Arts' },
    { pattern: /^m\.?a$/i, value: 'Master of Arts' },
    { pattern: /^b\.?com$/i, value: 'Bachelor of Commerce' },
    { pattern: /^m\.?com$/i, value: 'Master of Commerce' },
    { pattern: /^bba$/i, value: 'Bachelor of Business Administration' },
    { pattern: /^mba$/i, value: 'Master of Business Administration' },
    { pattern: /^b\.?pharm$/i, value: 'Bachelor of Pharmacy' },
    { pattern: /^m\.?pharm$/i, value: 'Master of Pharmacy' },
    { pattern: /^ph\.?d\.?$/i, value: 'Doctor of Philosophy' },
];

const DEGREE_RANKS: Array<{ pattern: RegExp; rank: number }> = [
    { pattern: /phd|doctor/i, rank: 6 },
    { pattern: /master|m\.?tech|mca|m\.?e\.?/i, rank: 5 },
    { pattern: /bachelor|b\.?tech|bca|b\.?e\.?/i, rank: 4 },
    { pattern: /diploma|associate/i, rank: 3 },
    { pattern: /high school|secondary|12th|10th/i, rank: 2 },
];

function toTitleCase(input: string): string {
    if (!input) return '';
    return input
        .split(/\s+/)
        .map(token => {
            if (/^[A-Z0-9.+#/-]{2,}$/.test(token)) return token;
            const lower = token.toLowerCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ')
        .trim();
}

function normalizeSkillName(value: string): string {
    const raw = toString(value);
    if (!raw) return '';
    const compact = raw.replace(/\s+/g, ' ').trim();
    const canonical = SKILL_CANONICAL_MAP[compact.toLowerCase()];
    if (canonical) return canonical;
    return toTitleCase(compact);
}

function normalizeSkillList(value: any): string[] {
    const skills = toStringArray(value)
        .map(normalizeSkillName)
        .filter(Boolean);
    return Array.from(new Set(skills));
}

function normalizeDegree(value: string): string {
    const raw = toString(value);
    if (!raw) return '';
    const compact = raw.replace(/\s+/g, ' ').trim();
    for (const entry of DEGREE_NORMALIZATION) {
        if (entry.pattern.test(compact)) return entry.value;
    }
    return compact;
}

function lineClamp(text: string, maxLength: number): string {
    const normalized = toString(text).replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function parseNumericDateToken(value: string): number {
    if (!value) return -1;
    const yearMatch = value.match(/(19|20)\d{2}/);
    if (!yearMatch) return -1;
    const year = Number(yearMatch[0]);

    const monthMatch = value.match(/(?:-|\/|\s)(0?[1-9]|1[0-2])(?:$|\b)/);
    const month = monthMatch?.[1] ? Number(monthMatch[1]) : 1;
    return year * 100 + month;
}

function degreeRank(degree: string): number {
    const normalized = degree.toLowerCase();
    for (const entry of DEGREE_RANKS) {
        if (entry.pattern.test(normalized)) return entry.rank;
    }
    return 1;
}

function uniqueStrings(items: string[]): string[] {
    return Array.from(new Set(items.filter(Boolean)));
}

function normalizeProjectTitle(value: any): string {
    return lineClamp(
        toString(value)
            .replace(/\(.*?\)/g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        80
    );
}

function collectProjectDescriptionParts(value: any): string[] {
    return toString(value)
        .split(/\r?\n|[•]/)
        .map(line => normalizeLineItem(line))
        .filter(Boolean);
}

function isTechnologyListDescription(description: string, technologies: string[]): boolean {
    const normalized = toString(description).toLowerCase().trim();
    if (!normalized) return false;
    if (/^(tech|technologies|stack)\s*:/i.test(normalized)) return true;

    const normalizedTechnologies = Array.from(new Set(
        normalizeSkillList(technologies)
            .map(tech => tech.toLowerCase())
            .filter(Boolean)
    ));
    const fragments = normalized
        .replace(/^(tech|technologies|stack)\s*:\s*/i, '')
        .split(/[,/|]+|\s+-\s+|\s+and\s+/i)
        .map(fragment => fragment.replace(/[().]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (normalizedTechnologies.length === 0) {
        return fragments.length >= 3 && fragments.every(fragment =>
            fragment.length <= 24 && /^[a-z0-9.+#/\-\s]+$/i.test(fragment)
        );
    }

    if (fragments.length === 0 || fragments.length > normalizedTechnologies.length + 1) return false;
    return fragments.every(fragment => normalizedTechnologies.some(tech =>
        fragment === tech || fragment.includes(tech) || tech.includes(fragment)
    ));
}

function sanitizeProjectDescription(value: any, technologies: string[]): string {
    const paragraph = collectProjectDescriptionParts(value)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!paragraph) return '';
    if (/^no description available$/i.test(paragraph)) return '';
    if (/^(tech|technologies|stack)\s*:/i.test(paragraph)) return '';
    // Allow very short descriptions if they contain an action verb (indicates quality)
    const verbPattern = /\b(built|developed|implemented|designed|created|engineered|led|improved|optimized|maintained|launched|deployed)\b/i;
    const hasVerb = verbPattern.test(paragraph);
    if (paragraph.length < 20 && !hasVerb) return '';
    if (isTechnologyListDescription(paragraph, technologies)) return '';

    return lineClamp(paragraph, 220);
}

/**
 * Extract simple impact metrics from a project description.
 * Looks for user/customer counts and percent improvements.
 */
function extractImpactMetrics(text: string): { users?: number; pct?: number; summary?: string; impactScore?: number } | null {
    const s = toString(text).replace(/[,]/g, '');
    if (!s) return null;

    // Users/customers patterns
    const usersPattern = /(?:used by|used daily by|used by over|used by around|served over|serving|serves)\s+([0-9][0-9\d\s,.]*)\s*(?:users|customers|people|clients)/i;
    const usersMatch = s.match(usersPattern) || s.match(/([0-9][0-9\d,\.]{1,})\s+(?:users|customers|people|clients)/i);
    let users: number | undefined;
    if (usersMatch?.[1]) {
        const n = usersMatch[1].replace(/[^0-9]/g, '');
        users = n ? Number(n) : undefined;
    }

    // Percent improvement patterns (reduced latency by 40%, improved throughput 20%)
    const pctPattern = /(?:improv(?:ed|e)?|increas(?:ed|e)?|reduc(?:ed|e)?|cut|boost(?:ed|s)?)\s+(?:by\s+)?([0-9]{1,3}(?:\.[0-9]+)?%)?/i;
    const pctMatch = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    const pct = pctMatch ? Number(pctMatch[1]) : undefined;

    if (!users && !pct) return null;

    // Derive a small impactScore for ranking
    let impactScore = 0;
    if (users) {
        if (users >= 1000000) impactScore += 60;
        else if (users >= 100000) impactScore += 50;
        else if (users >= 10000) impactScore += 40;
        else if (users >= 1000) impactScore += 25;
        else if (users >= 100) impactScore += 10;
        else impactScore += 5;
    }
    if (pct) {
        impactScore += Math.min(30, Math.round(pct));
    }

    const parts: string[] = [];
    if (users) parts.push(`${users.toLocaleString()} users`);
    if (pct) parts.push(`${pct}%`);

    return { users, pct, summary: parts.join(' · '), impactScore };
}

function computeProjectBaseScore(p: any, jobRequirements?: DashboardExtractionResult['jobRequirements']): number {
    const desc = toString(p?.description);
    const technologies = Array.isArray(p?.technologies) ? p.technologies : [];
    const verbPattern = /\b(built|developed|implemented|designed|created|engineered|led|improved|optimized|maintained|launched|deployed)\b/i;

    let score = 0;
    // Description richness (scaled)
    score += Math.min(desc.length, 400) * 0.2; // up to ~80
    // Verb presence bonus
    if (verbPattern.test(desc)) score += 50;
    // Technology breadth
    score += Math.min(technologies.length * 8, 40);
    // Impact
    if (p?.impact?.impactScore) score += Math.min(40, p.impact.impactScore);
    // Project type intelligence (semantic complexity boost)
    score += getProjectTypeScore(desc) * 10;

    // If JD provided, add modest weight for JD skill matches
    if (jobRequirements && (Array.isArray(jobRequirements.requiredSkills) || Array.isArray(jobRequirements.preferredSkills))) {
        const req = (jobRequirements.requiredSkills || []).map(normalizeSkillKey);
        const pref = (jobRequirements.preferredSkills || []).map(normalizeSkillKey);
        const projTechs = (technologies || []).map((t: string) => normalizeSkillKey(t));
        const matchedReq = new Set<string>();
        for (const t of projTechs) {
            if (req.includes(t)) matchedReq.add(t);
        }
        // Check description for additional mentions
        for (const r of req) {
            if (!matchedReq.has(r) && fuzzySkillMatch(desc, r)) matchedReq.add(r);
        }
        score += matchedReq.size * 30; // strong bonus per required match
    }

    return score;
}

function chooseBetterProject(
    current: DashboardExtractionResult['projects'][number] | null | undefined,
    incoming: DashboardExtractionResult['projects'][number] | null | undefined
): DashboardExtractionResult['projects'][number] {
    const existing = current || { title: '', description: '', technologies: [], extraCount: 0 } as any;
    const next = incoming || { title: '', description: '', technologies: [], extraCount: 0 } as any;

    // Ensure impact info is available
    if (!existing.impact) existing.impact = extractImpactMetrics(existing.description || '');
    if (!next.impact) next.impact = extractImpactMetrics(next.description || '');

    // Compute a comparative score (without JD context)
    const existingScore = computeProjectBaseScore(existing);
    const nextScore = computeProjectBaseScore(next);

    const chosen = nextScore >= existingScore ? next : existing;

    // Merge technologies (prefer longer list but dedupe)
    const techs = Array.from(new Set([...(existing.technologies || []), ...(next.technologies || [])].map((t: string) => normalizeSkillName(t)))).slice(0, 6);

    const merged: any = {
        title: chosen.title || existing.title || next.title || '',
        description: chosen.description || existing.description || next.description || '',
        technologies: techs,
        extraCount: Math.max(existing.extraCount || 0, next.extraCount || 0),
        impact: chosen.impact || existing.impact || next.impact || null,
    };

    // Base confidence derived from merged data
    const raw = computeProjectBaseScore(merged);
    merged.confidence = Math.max(0, Math.min(100, Math.round(raw / 2)));

    // Badges
    const badges: string[] = [];
    if (merged.impact && (merged.impact.users || merged.impact.pct)) badges.push('High Impact');
    merged.badges = badges;

    return merged;
}

function normalizeProjectEntry(item: any): DashboardExtractionResult['projects'][number] | null {
    const title = normalizeProjectTitle((item?.title ?? item?.name ?? '').toString().trim());
    const allTech = normalizeSkillList(item?.technologies);
    const shownTech = allTech.slice(0, 5);
    const description = sanitizeProjectDescription(
        item?.description || item?.desc || item?.summary,
        allTech
    );

    if (!title && !description && shownTech.length === 0) return null;

    const impact = extractImpactMetrics(item?.description || item?.desc || item?.summary || '');
    const base: any = {
        title,
        description,
        technologies: shownTech,
        extraCount: Math.max(0, allTech.length - shownTech.length),
        impact,
    };

    // Initial confidence heuristic (normalized)
    const raw = computeProjectBaseScore(base);
    base.confidence = Math.max(0, Math.min(100, Math.round(raw / 2)));

    // Basic badges
    base.badges = [] as string[];
    if (impact && (impact.users || impact.pct)) base.badges.push('High Impact');

    return base;
}

function normalizeProjectCollection(projects: any[]): DashboardExtractionResult['projects'] {
    return safeArray(projects)
        .map(project => normalizeProjectEntry(project))
        .filter((project): project is DashboardExtractionResult['projects'][number] => Boolean(project))
        .slice(0, 6);
}

/**
 * Merge structured resume data with extracted lists, preferring StructuredResume
 * as single source-of-truth when present. Returns pure, deduplicated lists.
 */
export function mergeAndDeduplicateResumeData(
    structuredResume?: StructuredResume | null,
    extractedProjects?: DashboardExtractionResult['projects'] | null,
    extractedEducation?: DashboardExtractionResult['education'] | null
): { projects: DashboardExtractionResult['projects']; education: DashboardExtractionResult['education'] } {
    // Convert structured projects -> dashboard shape
    const structuredProjects: DashboardExtractionResult['projects'] = (structuredResume?.projects || []).map((p: any) => ({
        title: normalizeProjectTitle((p?.title ?? p?.name ?? '').toString().trim()),
        description: toString(p?.description || (p as any)?.desc || ''),
        technologies: Array.isArray(p?.technologies) ? (p as any).technologies.map(String).map((t: string) => t.trim()).filter(Boolean) : [],
        extraCount: 0,
    }));

    const incomingProjects = Array.isArray(extractedProjects) ? extractedProjects.map(p => ({ ...p })) : [];

    const outProjects: DashboardExtractionResult['projects'] = [];
    const seenProj = new Set<string>();

    if (structuredProjects.length > 0) {
        for (const p of structuredProjects) {
            const key = stableProjectKey(p);
            if (!key || seenProj.has(key)) continue;
            seenProj.add(key);
            outProjects.push({ ...p });
        }
    } else {
        for (const p of incomingProjects) {
            const key = stableProjectKey(p as any);
            if (!key || seenProj.has(key)) continue;
            seenProj.add(key);
            outProjects.push({ ...p });
        }
    }

    // --- Education ---
    const structuredEduRaw: any[] = Array.isArray((structuredResume as any)?.education) ? (structuredResume as any).education : [];
    const structuredEducation = structuredEduRaw.map((e: any) => ({
        degree: toString(e?.degree || ''),
        institution: (e?.institution ?? e?.school ?? '').toString().trim(),
        startDate: e?.startDate || e?.start_date || e?.start || null,
        endDate: e?.endDate || e?.end_date || e?.end || null,
        isPresent: !!e?.isPresent || /present|current|ongoing/i.test(String((e?.endDate ?? e?.end) || '')),
        gpa: e?.gpa || null,
    }));

    const incomingEducation = Array.isArray(extractedEducation) ? (extractedEducation as any[]).map((e: any) => ({
        degree: toString(e?.degree || ''),
        institution: (e?.institution ?? e?.school ?? '').toString().trim(),
        startDate: e?.startDate ?? e?.start_date ?? e?.start ?? null,
        endDate: e?.endDate ?? e?.end_date ?? e?.end ?? null,
        isPresent: !!e?.isPresent || /present|current|ongoing/i.test(String((e?.endDate ?? e?.end) || '')),
        gpa: e?.gpa ?? null,
    })) : [];

    const outEducation: DashboardExtractionResult['education'] = [];
    const seenEdu = new Set<string>();

    if (structuredEducation.length > 0) {
        for (const ed of structuredEducation) {
            const key = stableEducationKey(ed as any);
            if (!key || seenEdu.has(key)) continue;
            seenEdu.add(key);
            outEducation.push({ ...ed } as any);
        }
    } else {
        for (const ed of incomingEducation) {
            const key = stableEducationKey(ed as any);
            if (!key || seenEdu.has(key)) continue;
            seenEdu.add(key);
            outEducation.push({ ...ed } as any);
        }
    }

    return { projects: outProjects, education: outEducation };
}

function mergeProjectCollections(currentProjects: any[], incomingProjects: any[]): DashboardExtractionResult['projects'] {
    // Helper: build a stable canonical key for a project to reduce near-duplicate titles
    function projectKey(p: DashboardExtractionResult['projects'][number]): string {
        const rawTitle = (p?.title ?? '').toString().trim();
        const normTitle = normalizeProjectTitle(rawTitle).toLowerCase().replace(/\s+/g, ' ').trim();
        const techList = (Array.isArray(p?.technologies) ? p.technologies.join(',') : '').toLowerCase().trim();
        if (normTitle) {
            // Use the normalized project title + tech list as primary dedupe key
            return `${normTitle}|${techList}`.trim();
        }

        // Fallback to description+tech key
        const desc = (p?.description || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
        return `${desc}|${techList}`.trim();
    }

    const merged = new Map<string, DashboardExtractionResult['projects'][number]>();

    for (const project of normalizeProjectCollection(currentProjects)) {
        const key = projectKey(project);
        if (!key) continue;
        merged.set(key, project);
    }

    for (const project of normalizeProjectCollection(incomingProjects)) {
        const key = projectKey(project);
        if (!key) continue;
        merged.set(key, chooseBetterProject(merged.get(key), project));
    }

    return Array.from(merged.values()).slice(0, 6);
}

/**
 * Hard deduplicate education entries by normalized degree+institution key.
 * Uses normalizeSkill-style normalization for robust matching.
 * Strict rule: require BOTH degree AND institution; drop incomplete entries.
 */
function dedupeEducation(list: any[]): any[] {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: any[] = [];

    for (const e of list) {
        if (!e) continue;

        const degree = (e.degree || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
        const institution = (e.institution ?? e.school ?? '').toString().toLowerCase().replace(/\s+/g, ' ').trim();

        // Strict: require BOTH degree and institution to consider deduping/returning
        if (!degree || !institution) continue;

        // Normalize start_date — prefer numeric canonical form when possible
        let startRaw = (e.start_date || e.start || '').toString().trim();
        let startKey = '';
        try {
            const parsed = parseNumericDateToken(startRaw);
            if (parsed > 0) {
                // Use numeric canonical (e.g., YYYYMM as number string)
                startKey = String(parsed);
            } else {
                startKey = startRaw.toLowerCase().replace(/\s+/g, ' ').trim();
            }
        } catch (_) {
            startKey = startRaw.toLowerCase().replace(/\s+/g, ' ').trim();
        }

        const key = `${institution}|${degree}|${startKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }

    return out;
}

/**
 * Block garbage education entries.
 * Removes entries where:
 * - degree contains "project" (misclassified project as education)
 * - degree contains email patterns or person names
 * - institution is missing entirely
 */
function blockGarbageEducation(list: any[]): any[] {
    if (!Array.isArray(list)) return [];
    return list.filter(e => {
        if (!e) return false;
        const degree = (e.degree || '').toString();
        const institution = (e.institution ?? e.school ?? '').toString().trim();
        // Must have institution
        if (!institution) return false;
        const degreeLower = degree.toLowerCase();
        // Block if degree contains "project"
        if (degreeLower.includes('project')) return false;
        // Block if degree contains email pattern
        if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(degree)) return false;
        // Block if degree is suspiciously long (likely garbage text)
        if (degree.length > 150) return false;
        // Block common garbage patterns
        if (/blogging|tarun|email|portfolio|github|linkedin|resume/i.test(degreeLower)) return false;
        return true;
    });
}

/**
 * Final sanity layer applied AFTER all merging and processing.
 * Enforces hard limits and data quality.
 */
function finalSanityLayer(result: DashboardExtractionResult): DashboardExtractionResult {
    // Skills: dedupe + max 15
    if (Array.isArray(result.skills)) {
        const seen = new Set<string>();
        result.skills = result.skills.filter(s => {
            const key = normalizeSkill(s);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 15);
    }

    // Projects: sanitize descriptions + max 2
    if (Array.isArray(result.projects)) {
        // Preserve computed badges/confidence/impact while still normalizing core fields
        result.projects = safeArray(result.projects)
            .map(p => {
                const techs = normalizeSkillList(p?.technologies || []);
                const desc = sanitizeProjectDescription(p?.description || '', techs);
                return {
                    title: normalizeProjectTitle((p?.title ?? '').toString().trim()),
                    description: desc,
                    technologies: techs.slice(0, 5),
                    extraCount: Math.max(0, (p?.extraCount || 0)),
                    badges: Array.isArray(p?.badges) ? uniqueStrings(p.badges) : [],
                    confidence: Number(p?.confidence) || 0,
                    impact: p?.impact || null,
                } as any;
            })
            .filter(project => !isTechnologyListDescription(project.description, project.technologies))
            .slice(0, 2);
    }

    // Education: dedupe + valid only + garbage filter
    if (Array.isArray(result.education)) {
        result.education = blockGarbageEducation(dedupeEducation(result.education));
    }

    // Match score: ensure not null when JD present
    // (this is a fallback guard; the primary fix is in computeMatchScore)

    console.log('FINAL SKILLS:', result.skills?.length ?? 0);
    console.log('FINAL PROJECTS:', result.projects?.map(project => ({
        title: project.title,
        technologies: project.technologies,
    })) ?? []);
    console.log('FINAL DESCRIPTION LENGTH:', result.projects?.map(project => project.description.length) ?? []);
    console.log('FINAL EDUCATION:', result.education?.length ?? 0);
    console.log('MATCH SCORE:', result.matchInsights?.matchScore ?? null);

    return result;
}

function safeArray(value: any): any[] {
    return Array.isArray(value) ? value : [];
}

/**
 * Canonical skill synonym map.
 * Maps common aliases/abbreviations to a single canonical form.
 * Applied inside normalizeSkillKey so ALL skill matching automatically resolves synonyms.
 */
const SKILL_SYNONYMS: Record<string, string> = {
    // Normalize node variants to a single canonical token
    'nodejs': 'nodejs',
    'node.js': 'nodejs',
    'node': 'nodejs',
    'reactjs': 'react',
    'react.js': 'react',
    'vuejs': 'vue',
    'vue.js': 'vue',
    'angularjs': 'angular',
    'angular.js': 'angular',
    'expressjs': 'express',
    'express.js': 'express',
    'nextjs': 'next',
    'next.js': 'next',
    'nuxtjs': 'nuxt',
    'nuxt.js': 'nuxt',
    'ml': 'machine learning',
    'dl': 'deep learning',
    'ai': 'artificial intelligence',
    'k8s': 'kubernetes',
    'pg': 'postgresql',
    'postgres': 'postgresql',
    // Prefer a compact `mongo` key for MongoDB variants
    'mongodb': 'mongo',
    'mongo': 'mongo',
    'mongo db': 'mongo',
    'tf': 'tensorflow',
    'ts': 'typescript',
    'js': 'javascript',
    'py': 'python',
    'rb': 'ruby',
    'c sharp': 'c#',
    'csharp': 'c#',
    'golang': 'go',
    'cpp': 'c++',
    'aws lambda': 'serverless',
    'gke': 'kubernetes',
    'aks': 'kubernetes',
    'eks': 'kubernetes',
    'scikit': 'scikit-learn',
    'sklearn': 'scikit-learn',
    'psql': 'postgresql',
    'dynamodb': 'dynamodb',
    'dynamo': 'dynamodb',
    'ci cd': 'ci/cd',
    'cicd': 'ci/cd',
    'rest api': 'rest',
    'restful': 'rest',
    'graphql api': 'graphql',
};

/**
 * Normalize a skill string for comparison.
 * Strips dots, lowercases, trims, then resolves known synonyms.
 */
function normalizeSkillKey(s: string): string {
    const stripped = s.toLowerCase().replace(/\./g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    return SKILL_SYNONYMS[stripped] || SKILL_SYNONYMS[s.toLowerCase().trim()] || stripped;
}

/**
 * Friendly normalizer that maps common variants to canonical synonym keys.
 * Use this for match comparisons when evaluating resume vs JD skills.
 */
function normalizeSkill(skill: string): string {
    // Simplified normalization to improve matching consistency across variants
    // e.g. Node.js, nodejs, NODE.js -> nodejs; React, react -> react
    return String(skill || '').toLowerCase().replace(/\.js/g, '').trim();
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

// Fuzzy skill text matcher to avoid fragile substring checks.
function fuzzySkillMatch(text: string, skill: string): boolean {
    if (!skill) return false;
    const normalizedText = toString(text).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizedSkill = toString(skill).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalizedSkill) return false;

    // direct full-skill match
    if (normalizedText.includes(normalizedSkill)) return true;

    const parts = normalizedSkill.split(' ').filter(Boolean);
    if (parts.length > 1) {
        // all parts present separately (e.g., "machine" and "learning")
        if (parts.every(p => normalizedText.includes(p))) return true;
        // acronym match (e.g., "machine learning" -> "ml")
        const acronym = parts.map(p => p[0]).join('');
        if (acronym.length > 1 && normalizedText.split(/\s+/).includes(acronym)) return true;
        // compact form match (e.g., "rest api" -> "restapi")
        const compact = parts.join('');
        if (normalizedText.includes(compact)) return true;
    } else {
        // single token: check token boundaries
        const tokens = normalizedText.split(/\s+/);
        if (tokens.includes(normalizedSkill)) return true;
    }

    return false;
}

function getProjectTypeScore(text: string): number {
    const t = toString(text).toLowerCase();
    if (/real[- ]?time|websocket|stream/i.test(t)) return 5;
    if (/ai|ml|nlp|deep learning/i.test(t)) return 4;
    if (/system|architecture|backend|engine/i.test(t)) return 3;
    if (/crud|basic|simple/i.test(t)) return 1;
    return 0;
}

/**
 * Compute a simple extraction confidence score based on presence of core sections.
 * Higher is better. Used for telemetry, retry heuristics, and UI decisions.
 */
function computeExtractionConfidence(parsed: any): number {
    let score = 0;
    if (Array.isArray(parsed.skills) && parsed.skills.length > 5) score += 30;
    if (Array.isArray(parsed.projects) && parsed.projects.length > 0) score += 25;
    if (Array.isArray(parsed.education) && parsed.education.length > 0) score += 20;
    if (Array.isArray(parsed.experience) && parsed.experience.length > 0) score += 15;
    return Math.min(score, 100);
}

/**
 * Score projects by accumulated description length.
 * This prefers richer project entries over raw counts.
 */
function scoreProjects(projects: any[]): number {
    if (!Array.isArray(projects)) return 0;
    return projects.reduce((acc: number, p: any) => {
        const desc = (p && (p.description || p.desc || p.summary)) || '';
        return acc + (String(desc).length || 0);
    }, 0);
}

function extractSectionLines(rawText: string, sectionMatchers: RegExp[]): string[] {
    if (!rawText.trim()) return [];
    const lines = rawText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return [];

    const headingPattern = /^(education|academics?|projects?|skills?|technical skills|experience|work experience|employment|certifications?|achievements?|summary|profile|leadership)$/i;
    const startIndex = lines.findIndex(line => sectionMatchers.some(pattern => pattern.test(line)) && line.length <= 50);
    if (startIndex < 0) return [];

    let endIndex = lines.length;
    for (let i = startIndex + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (headingPattern.test(line)) {
            endIndex = i;
            break;
        }
    }

    return lines.slice(startIndex + 1, endIndex).filter(Boolean);
}

function parseDateRange(text: string): { startDate: string; endDate: string } {
    const years = Array.from(text.matchAll(/\b(19|20)\d{2}\b/g)).map(match => match[0]);
    const orderedYears = Array.from(new Set(years));

    if (orderedYears.length >= 2) {
        return {
            startDate: orderedYears[0],
            endDate: orderedYears[orderedYears.length - 1],
        };
    }

    if (orderedYears.length === 1) {
        return {
            startDate: orderedYears[0],
            endDate: /present|current|ongoing/i.test(text) ? 'Present' : '',
        };
    }

    return {
        startDate: '',
        endDate: /present|current|ongoing/i.test(text) ? 'Present' : '',
    };
}

function extractGradeValue(text: string): string {
    const explicit = text.match(/(?:gpa|cgpa|grade|percentage|percent|marks?)\s*[:\-]?\s*([A-Za-z0-9./%+-]+)/i);
    if (explicit?.[1]) return explicit[1].trim();

    const percent = text.match(/\b\d{1,2}(?:\.\d+)?\s*%\b/);
    if (percent?.[0]) return percent[0].replace(/\s+/g, '');

    return '';
}

function extractYear(date: string | null): string | null {
    if (!date) return null;
    const m = date.match(/\d{4}/);
    return m ? m[0] : null;
}

function parseEducationBlock(block: string) {
    const degreePattern = /(bachelor|master|doctor|phd|b\.?\s?tech|m\.?\s?tech|bca|mca|b\.?\s?e\.?|m\.?\s?e\.?|diploma|associate|degree|12th|secondary)/i;
    const institutionPattern = /(university|college|institute|school|academy|faculty|department)/i;

    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const degreeLine = lines.find(l => degreePattern.test(l)) || '';
    const institutionLine = lines.find(l => institutionPattern.test(l)) || '';
    const gpa = extractGradeValue(block) || null;

    // Extract years explicitly; do NOT borrow dates from other blocks
    const years = Array.from(block.matchAll(/\b(19|20)\d{2}\b/g)).map(m => m[0]);
    let startDate: string | null = null;
    let endDate: string | null = null;
    let isPresent = /present|current|ongoing/i.test(block);

    if (years.length >= 2) {
        startDate = extractYear(years[0]);
        endDate = extractYear(years[years.length - 1]);
    } else if (years.length === 1) {
        // Single year — ambiguous; treat as start (prefer not to invent end date)
        startDate = extractYear(years[0]);
        if (isPresent) {
            endDate = null;
        } else {
            endDate = null;
        }
    } else {
        // No explicit years found — do not assign any dates
        startDate = null;
        endDate = null;
        isPresent = false;
    }

    return {
        degree: normalizeDegree(lineClamp(degreeLine || lines.join(' '), 120)),
        institution: lineClamp(institutionLine || lines.join(' '), 120),
        startDate,
        endDate: isPresent ? null : endDate,
        isPresent,
        gpa,
    } as any;
}

function inferAcademicBackgroundFromResumeText(resumeText: string): DashboardExtractionResult['education'] {
    const lines = resumeText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const blocks: string[] = [];
    let currentBlock: string[] = [];

    for (const line of lines) {
        // Start a new block at a clear degree signal if we already have content
        if (/(bachelor|master|mca|bca|phd|doctor|diploma|12th|secondary|degree)/i.test(line) && currentBlock.length > 0) {
            blocks.push(currentBlock.join('\n'));
            currentBlock = [];
        }

        currentBlock.push(line);

        // Also split on visual separators
        if (/^[-–*]{2,}$/.test(line)) {
            if (currentBlock.length > 0) {
                blocks.push(currentBlock.join('\n'));
                currentBlock = [];
            }
        }
    }

    if (currentBlock.length) blocks.push(currentBlock.join('\n'));

    const parsed = blocks.map(block => parseEducationBlock(block)).filter(Boolean);

    const dedup = new Set<string>();
    return parsed
        .filter(item => item.degree || item.institution)
        .filter(item => {
            const key = `${(item.degree || '').toLowerCase()}|${(item.institution || '').toLowerCase()}`;
            if (dedup.has(key)) return false;
            dedup.add(key);
            return true;
        })
        .sort((a, b) => {
            const rankDiff = degreeRank(b.degree) - degreeRank(a.degree);
            if (rankDiff !== 0) return rankDiff;
            return parseNumericDateToken(b.endDate || b.startDate || '') - parseNumericDateToken(a.endDate || a.startDate || '');
        });
}

function mergeAcademicBackgroundEntries(
    value: any,
    resumeText: string
): DashboardExtractionResult['education'] {
    const parsedEntries = safeArray(value)
        .map((item: any) => {
            const startDate = toString(item?.startDate) || null;
            const rawEndDate = toString(item?.endDate);
            const isPresent = item?.isPresent === true || /present|current|ongoing/i.test(rawEndDate) || (!!startDate && !rawEndDate);
            const endDate = isPresent ? null : (rawEndDate || null);
            return {
                degree: normalizeDegree(item?.degree),
                institution: (item?.institution ?? item?.school ?? '').toString().trim(),
                startDate,
                endDate,
                isPresent,
                gpa: toString(item?.gpa || item?.grade) || null,
            };
        })
        .filter((item: any) => item.degree || item.institution || item.startDate || item.gpa);

    const inferredEntries = inferAcademicBackgroundFromResumeText(resumeText);
    const consumedInferred = new Set<number>();

    const merged = parsedEntries.map((entry: any) => {
        let inferredMatchIndex = inferredEntries.findIndex((candidate, index) => (
            !consumedInferred.has(index)
            && (
                (entry.degree && candidate.degree && entry.degree.toLowerCase() === candidate.degree.toLowerCase())
                || (entry.institution && candidate.institution && entry.institution.toLowerCase() === candidate.institution.toLowerCase())
            )
        ));

        // Only merge on actual degree/institution match. Do NOT blindly assign
        // the next unused inferred entry — that mixes dates between unrelated entries.

        const fallback = inferredMatchIndex >= 0 ? inferredEntries[inferredMatchIndex] : null;
        if (inferredMatchIndex >= 0) consumedInferred.add(inferredMatchIndex);

        const mergedIsPresent = entry.isPresent || fallback?.isPresent || false;
        return {
            degree: entry.degree || fallback?.degree || '',
            institution: (entry.institution ?? fallback?.institution ?? '').toString().trim(),
            startDate: entry.startDate || fallback?.startDate || null,
            endDate: mergedIsPresent ? null : (entry.endDate || fallback?.endDate || null),
            isPresent: mergedIsPresent,
            gpa: entry.gpa || fallback?.gpa || null,
        };
    });

    inferredEntries.forEach((entry, index) => {
        if (!consumedInferred.has(index)) {
            merged.push(entry);
        }
    });

    // Dedup by degree+institution per strict spec
    const dedup = new Set<string>();
    return merged
        .filter(item => item.degree || item.institution || item.startDate || item.gpa)
        .filter(item => {
            const key = `${item.degree.toLowerCase()}|${item.institution.toLowerCase()}`;
            if (dedup.has(key)) return false;
            dedup.add(key);
            return true;
        })
        .sort((a, b) => {
            const rankDiff = degreeRank(b.degree) - degreeRank(a.degree);
            if (rankDiff !== 0) return rankDiff;
            return parseNumericDateToken(b.endDate || b.startDate || '') - parseNumericDateToken(a.endDate || a.startDate || '');
        });
}

/**
 * Normalize education dates to ensure consistency.
 * - If endDate contains "present"/"ongoing"/"current", set isPresent = true, endDate = null.
 * - Per strict spec: NEVER swap dates even if incorrect.
 * - If start exists & end missing → isPresent = true.
 * - Ensure no two entries share the same date range (deduplication).
 */
function normalizeAcademicEntryDates(
    entries: DashboardExtractionResult['education']
): DashboardExtractionResult['education'] {
    const usedDateRanges = new Set<string>();

    return entries.map(entry => {
        let { startDate, endDate, isPresent } = entry;

        // Normalize explicit ongoing markers
        if (endDate && /present|current|ongoing/i.test(endDate)) {
            isPresent = true;
            endDate = null;
        }

        // If start exists but end missing and not already marked present
        if (startDate && !endDate && !isPresent) {
            isPresent = true;
        }

        // Date-sharing guard: if this exact date range was already assigned
        // to a previous entry, discard dates from this entry to prevent
        // cross-contamination between education entries.
        const dateKey = `${startDate || ''}|${endDate || ''}`;
        if (startDate && endDate && usedDateRanges.has(dateKey)) {
            startDate = null;
            endDate = null;
        } else if (startDate || endDate) {
            usedDateRanges.add(dateKey);
        }

        return { ...entry, startDate, endDate, isPresent };
    });
}

function inferProjectsFromResumeText(resumeText: string): DashboardExtractionResult['projects'] {
    const sectionLines = extractSectionLines(resumeText, [/projects?/i]);
    if (sectionLines.length === 0) return [];

    const entries: Array<{ title: string; descriptionParts: string[] }> = [];
    let current: { title: string; descriptionParts: string[] } | null = null;

    const flush = () => {
        if (!current) return;
        if (current.title) entries.push(current);
        current = null;
    };

    for (const rawLine of sectionLines) {
        const line = normalizeLineItem(rawLine);
        if (!line) continue;
        if (/^projects?$/i.test(line)) continue;

        const looksLikeTitle =
            line.length <= 90
            && !/\b(19|20)\d{2}\b/.test(line)
            && !/^(developed|built|implemented|created|designed|improved|optimized|using|with)\b/i.test(line)
            && !line.startsWith('http');

        if (looksLikeTitle) {
            flush();
            current = { title: lineClamp(line, 80), descriptionParts: [] };
            continue;
        }

        if (!current) {
            current = { title: lineClamp(line.split(':')[0] || line, 80), descriptionParts: [] };
        }
        current.descriptionParts.push(line);
    }

    flush();

    return entries
        .map(entry => {
            const rawDescription = entry.descriptionParts.join('\n');
            const allTechnologies = normalizeSkillList(inferSkillsFromText(`${entry.title}\n${rawDescription}`));
            const technologies = Array.from(new Set(allTechnologies)).slice(0, 5);
            const finalDescription = sanitizeProjectDescription(rawDescription, allTechnologies);
            return {
                title: normalizeProjectTitle(entry.title),
                description: finalDescription,
                technologies,
                extraCount: Math.max(0, allTechnologies.length - technologies.length),
            };
        })
        .filter(item => item.title || item.description || item.technologies.length > 0)
        .slice(0, 6); // Collect up to 6 projects; ranking selects best 2.
}

function inferExperienceFromResumeText(resumeText: string): DashboardExtractionResult['experience'] {
    const sectionLines = extractSectionLines(resumeText, [/experience/i, /employment/i, /work history/i]);
    if (sectionLines.length === 0) return [];

    // Internal type to accumulate parsed data before converting to final shape
    interface RawExp { role: string; company: string; rawDuration: string; description: string; }
    const entries: RawExp[] = [];
    let current: RawExp | null = null;

    const flush = () => {
        if (!current) return;
        if (current.role || current.company || current.description) {
            entries.push({
                role: lineClamp(current.role, 80),
                company: lineClamp(current.company, 80),
                rawDuration: lineClamp(current.rawDuration, 80),
                description: lineClamp(current.description, 200),
            });
        }
        current = null;
    };

    for (const rawLine of sectionLines) {
        const line = normalizeLineItem(rawLine);
        if (!line) continue;

        const roleCompanyMatch = line.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
        const separatorMatch = line.match(/^(.+?)\s*[|]\s*(.+?)(?:\s*[|]\s*(.+))?$/);

        if (roleCompanyMatch) {
            flush();
            current = {
                role: toString(roleCompanyMatch[1]),
                company: toString(roleCompanyMatch[2]),
                rawDuration: '',
                description: '',
            };
            continue;
        }

        if (separatorMatch && separatorMatch[1] && separatorMatch[2]) {
            flush();
            current = {
                role: toString(separatorMatch[1]),
                company: toString(separatorMatch[2]),
                rawDuration: toString(separatorMatch[3]),
                description: '',
            };
            continue;
        }

        const hasDateSignal = /\b(19|20)\d{2}\b/.test(line) || /present|current|ongoing/i.test(line);
        if (hasDateSignal && current && !current.rawDuration) {
            current.rawDuration = line;
            continue;
        }

        if (!current) {
            current = {
                role: '',
                company: '',
                rawDuration: '',
                description: '',
            };
        }

        current.description = `${current.description} ${line}`.trim();
    }

    flush();

    // Convert raw entries to final shape with startDate/endDate/isPresent/duration
    return entries.slice(0, 8).map(entry => {
        const dateRange = parseDateRange(entry.rawDuration);
        const isPresent = /present|current|ongoing/i.test(entry.rawDuration) || (!!dateRange.startDate && !dateRange.endDate);
        const startDate = dateRange.startDate || null;
        const endDate = isPresent ? null : (dateRange.endDate || null);
        const duration = computeExperienceDuration(entry.rawDuration, startDate || undefined, endDate || undefined);
        return {
            role: entry.role,
            company: entry.company,
            startDate,
            endDate,
            isPresent,
            duration,
            description: entry.description,
        };
    });
}

function extractJDSkills(text: string): string[] {
    if (!text) return [];
    const pattern = /\b(node\.?js|react|mongodb|mysql|express|typescript|git|python|java|golang|c\+\+|c#|ruby|rust|next\.?js|angular\.?js)\b/ig;
    const matches = String(text || '').match(pattern);
    if (!matches) return [];
    return Array.from(new Set(matches.map(m => m.toLowerCase().replace(/\./g, '').trim())));
}

function inferPreferredSkillsFromJDText(jdText: string): string[] {
    const lines = jdText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => /preferred|nice to have|good to have|bonus|plus/i.test(line));

    if (lines.length === 0) return [];
    const candidateText = lines.join('\n');
    const extracted = extractJDSkills(candidateText);
    if (extracted.length > 0) return normalizeSkillList(extracted);
    return normalizeSkillList(inferSkillsFromText(candidateText));
}

function inferRequiredSkillsFromJDText(jdText: string): string[] {
    const lines = jdText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => /required|requirements|must have|must-have|qualification|experience with|proficient/i.test(line));

    if (lines.length > 0) {
        const candidateText = lines.join('\n');
        const extracted = extractJDSkills(candidateText);
        if (extracted.length > 0) return normalizeSkillList(extracted);
        const required = normalizeSkillList(inferSkillsFromText(candidateText));
        if (required.length > 0) return required;
    }

    // Fallback: try targeted regex extraction across full JD, else the generic heuristic
    const fallbackExtracted = extractJDSkills(jdText);
    if (fallbackExtracted.length > 0) return normalizeSkillList(fallbackExtracted);

    return normalizeSkillList(inferSkillsFromText(jdText));
}

function inferResponsibilitiesFromJDText(jdText: string): string[] {
    return pickLinesBySignals(jdText, [
        /responsib/i,
        /you will/i,
        /develop/i,
        /design/i,
        /build/i,
        /maintain/i,
        /collaborat/i,
        /lead/i,
        /own/i,
    ], 8);
}

function detectSectionsFromResumeText(
    resumeText: string,
    output: DashboardExtractionResult
): string[] {
    const lines = resumeText
        .split(/\r?\n/)
        .map(line => line.trim().toLowerCase())
        .filter(Boolean);

    const detected = new Set<string>();
    const sectionRules: Array<{ name: string; pattern: RegExp }> = [
        { name: 'education', pattern: /^education$|^academics?$|^academic background$/i },
        { name: 'projects', pattern: /^projects?$|^personal projects?$/i },
        { name: 'skills', pattern: /^skills?$|^technical skills$/i },
        { name: 'experience', pattern: /^experience$|^work experience$|^employment$/i },
    ];

    for (const line of lines) {
        for (const rule of sectionRules) {
            if (rule.pattern.test(line)) {
                detected.add(rule.name);
            }
        }
    }

    if (output.education.length > 0) detected.add('education');
    if (output.projects.length > 0) detected.add('projects');
    if (output.skills.length > 0) detected.add('skills');
    if (output.experience.length > 0) detected.add('experience');

    const ordered = ['education', 'projects', 'skills', 'experience'];
    return ordered.filter(section => detected.has(section));
}

function buildDebugInfo(
    rawResumeText: string,
    rawJdText: string,
    output: DashboardExtractionResult
): DashboardExtractionResult['debug'] {
    const resumeLength = rawResumeText.length;
    const jdLength = rawJdText.length;

    if (!rawResumeText.trim()) {
        return {
            resumeLength,
            jdLength,
            sectionsDetected: [],
            notes: 'Resume text empty',
        };
    }

    const notes: string[] = [];
    if (!rawJdText.trim()) {
        notes.push('JD text missing; extracted resume data only');
    }

    if (output.education.length > 0) {
        const missingGpa = output.education.some(item => !item.gpa);
        const missingDates = output.education.some(item => !item.startDate || (!item.endDate && !item.isPresent));
        const missingInstitution = output.education.some(item => !item.institution);

        if (missingGpa) notes.push('Education found but missing GPA in one or more entries');
        if (missingDates) notes.push('Education found but date range is incomplete in one or more entries');
        if (missingInstitution) notes.push('Education found but institution name is unclear in one or more entries');
    }

    if (output.jobRequirements.requiredSkills.length === 0 && rawJdText.trim()) {
        notes.push('JD found but required skills were unclear');
    }

    const sectionsDetected = detectSectionsFromResumeText(rawResumeText, output);
    if (sectionsDetected.length === 0) {
        notes.push('No standard resume sections detected');
    }

    return {
        resumeLength,
        jdLength,
        sectionsDetected,
        notes: notes.join('; '),
    };
}

function isWeakDashboardExtraction(result: DashboardExtractionResult): boolean {
    return (
        result.education.length === 0
        && result.skills.length === 0
        && result.projects.length === 0
    );
}

/**
 * Compute a human-readable duration string from raw date text.
 * Examples: "Jan 2020 – Dec 2022" → "2 yrs 11 mos",  "2 years" → "2 yrs".
 */
function computeExperienceDuration(rawDuration: string, startDate?: string, endDate?: string): string {
    if (!rawDuration && !startDate && !endDate) return '';

    // If already contains a human duration, keep it.
    if (rawDuration && /\d+\s*(year|yr|month|mo)/i.test(rawDuration)) {
        return rawDuration;
    }

    // Try to parse from dates.
    const parseDate = (text: string | undefined): { year: number; month: number } | null => {
        if (!text) return null;
        const s = text.trim();
        const iso = s.match(/^(\d{4})-(\d{1,2})/);
        if (iso) return { year: parseInt(iso[1], 10), month: parseInt(iso[2], 10) };
        const yearOnly = s.match(/^(\d{4})$/);
        if (yearOnly) return { year: parseInt(yearOnly[1], 10), month: 1 };
        const monthNames: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
        const my = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
        if (my) return { year: parseInt(my[2], 10), month: monthNames[my[1].slice(0,3).toLowerCase()] || 1 };
        return null;
    };

    // If rawDuration contains dates, extract years from it.
    const source = rawDuration || `${startDate || ''} ${endDate || ''}`;
    const years = Array.from(source.matchAll(/(19|20)\d{2}/g)).map(m => m[0]);
    let start = parseDate(startDate || (years[0] || ''));
    let end: { year: number; month: number } | null = null;

    if (/present|current|ongoing/i.test(source)) {
        const now = new Date();
        end = { year: now.getFullYear(), month: now.getMonth() + 1 };
    } else {
        end = parseDate(endDate || (years.length >= 2 ? years[years.length - 1] : ''));
    }

    if (!start || !end) {
        return rawDuration || '';
    }

    const totalMonths = (end.year - start.year) * 12 + (end.month - start.month);
    if (totalMonths <= 0) return rawDuration || '';

    const yrs = Math.floor(totalMonths / 12);
    const mos = totalMonths % 12;
    const parts: string[] = [];
    if (yrs > 0) parts.push(`${yrs} yr${yrs > 1 ? 's' : ''}`);
    if (mos > 0) parts.push(`${mos} mo${mos > 1 ? 's' : ''}`);
    return parts.join(' ') || rawDuration || '';
}

/**
 * Rank projects by JD relevance. Returns TOP N most relevant projects.
 *
 * Criteria:
 *  1. Skill overlap with JD required/preferred skills (weight: 3 per match)
 *  2. Keyword match with JD technologies/keywords (weight: 2 per match)
 *  3. Project complexity heuristic (keywords like "system", "AI", "backend", "scalable") (weight: 1 per match)
 */
function rankProjects(
    projects: DashboardExtractionResult['projects'],
    jobRequirements: DashboardExtractionResult['jobRequirements'],
    topN: number = 2
): DashboardExtractionResult['projects'] {
    if (!Array.isArray(projects) || projects.length === 0) return [];

    const jdSkills = [
        ...(jobRequirements?.requiredSkills || []),
        ...(jobRequirements?.preferredSkills || [])
    ].map(s => normalizeSkillKey(s));

    return projects
        .map(project => {
            const title = (project.title || '').toLowerCase();
            const desc = (project.description || '').toLowerCase();
            const text = `${title} ${desc}`;

            let score = 0;
            let matchedCount = 0;

            // 1. Exact tech match (VERY HIGH) + 2. Text matches (only new ones)
            const matchedSkills = new Set<string>();

            // Exact matches from declared technologies
            for (const tech of project.technologies || []) {
                const normTech = normalizeSkillKey(tech);
                if (jdSkills.includes(normTech)) {
                    score += 4;
                    matchedSkills.add(normTech);
                }
            }

            // Text matches: only count skills not already matched via tech list
            for (const skill of jdSkills) {
                if (!skill) continue;
                if (fuzzySkillMatch(text, skill)) {
                    const normSkill = normalizeSkillKey(skill);
                    if (!matchedSkills.has(normSkill)) {
                        score += 2;
                        matchedSkills.add(normSkill);
                    }
                }
            }

            matchedCount = matchedSkills.size;

            // 3. Project type/context weighting (semantic boost)
            score += getProjectTypeScore(text);

            // 4. Complexity keywords
            if (/scalable|architecture|distributed|microservices/i.test(text)) {
                score += 2;
            }

            // 5. Tech stack richness
            score += (project.technologies?.length || 0) * 1.2;

            // 6. Description quality (word-count based)
            const wordCount = (project.description || '').split(/\s+/).filter(Boolean).length;
            if (wordCount >= 20 && wordCount <= 80) {
                score += 2;
            } else if (wordCount > 80) {
                score += 1;
            } else {
                score += 0.5;
            }

            // Strong alignment boost
            if (matchedCount >= 2) {
                score += 3;
            }

            return { ...project, __score: score, __reason: `Matched ${matchedCount} JD skills` } as any;
        })
        .sort((a, b) => (b.__score || 0) - (a.__score || 0))
        .slice(0, topN)
        .map(({ __score, ...rest }: any) => rest as any);
}

function emptyDashboardExtraction(): DashboardExtractionResult {
    return {
        debug: {
            resumeLength: 0,
            jdLength: 0,
            sectionsDetected: [],
            notes: '',
        },
        projects: [],
        education: [],
        skills: [],
        experience: [],
        jobRequirements: {
            role: null,
            requiredSkills: [],
            preferredSkills: [],
            responsibilities: [],
        },
        matchInsights: {
            matchScore: 0,
            matchedSkills: [],
            missingSkills: [],
            strongProjects: [],
            weakAreas: [],
            talkingPoints: [],
        },
    };
}

function buildDashboardExtractionPrompt(resumeText: string, jdText: string): string {
    return [
        'You are a strict resume + job description extractor.',
        'Your goal is to produce CLEAN, DEDUPLICATED, and STRUCTURED data.',
        'Return ONLY valid JSON. No markdown fences. No commentary.',
        '',
        'Use this exact JSON schema:',
        '{',
        '  "skills": ["string"],',
        '  "experience": [{ "role": "", "company": "", "startDate": "string|null", "endDate": "string|null", "isPresent": false, "description": "" }],',
        '  "projects": [{ "title": "", "description": "", "technologies": [""] }],',
        '  "education": [{ "degree": "", "institution": "", "startDate": "string|null", "endDate": "string|null", "isPresent": false, "gpa": "string|null" }],',
        '  "jobRequirements": { "role": "string|null", "requiredSkills": [""], "responsibilities": [""] }',
        '}',
        '',
        '## CRITICAL RULES',
        '',
        '### NO DUPLICATES',
        '- NEVER repeat the same education, project, or experience.',
        '- Deduplicate using: (degree + institution), (project title), (role + company).',
        '',
        '### DATE HANDLING (STRICT)',
        '- If both start & end exist → normalize to YYYY-MM or YYYY.',
        '- If start exists & end missing → set isPresent = true, endDate = null.',
        '- If both missing → keep null.',
        '- NEVER fabricate dates. NEVER swap dates even if incorrect.',
        '',
        '### EDUCATION CLEANUP',
        '- One entry per degree only.',
        '- DO NOT output multiple formats of same degree.',
        '- Prefer most complete version.',
        '- Normalize BCA to "Bachelor of Computer Application", MCA to "Master of Computer Application".',
        '',
        '### SKILL FILTERING',
        '- ONLY include skills that clearly appear in resume OR are strongly implied by projects/experience.',
        '- REMOVE generic tools (MS Office, basic computer skills).',
        '- REMOVE duplicates or variants (ReactJS, React → React).',
        '- Skills must be in canonical form (nodejs → Node.js, reactjs → React, typescript → TypeScript).',
        '- Limit to TOP 15-20 most relevant skills.',
        '',
        '### EXPERIENCE RULE',
        '- If no real job experience exists → return empty array.',
        '- DO NOT convert projects into experience.',
        '',
        '### PROJECT QUALITY',
        '- Only include meaningful projects.',
        '- Each must have a description and technologies.',
        '',
        '### JOB DESCRIPTION HANDLING',
        '- If jd_text is missing or empty: jobRequirements.role = null, requiredSkills = [], responsibilities = [].',
        '- DO NOT hallucinate job data.',
        '',
        '### NO FABRICATION',
        '- Do NOT invent experience, dates, skills, or projects.',
        '',
        '### OUTPUT QUALITY',
        '- Keep output minimal, clean, and consistent.',
        '- Project and experience descriptions: UI-friendly, max ~2 lines each.',
        '',
        'resume_text:',
        resumeText,
        '',
        'jd_text:',
        jdText,
    ].join('\n');
}

function fallbackDashboardExtractionFromText(resumeText: string, jdText: string): DashboardExtractionResult {
    const output = emptyDashboardExtraction();

    const resumeSkills = normalizeSkillList(inferSkillsFromText(resumeText));
    const jdSkills = inferRequiredSkillsFromJDText(jdText);
    const preferredJDSkills = inferPreferredSkillsFromJDText(jdText);
    const allProjects = inferProjectsFromResumeText(resumeText);
    const rawEducation = normalizeAcademicEntryDates(mergeAcademicBackgroundEntries([], resumeText));

    // Hard dedup education by degree+institution
    const eduDedup: Record<string, typeof rawEducation[number]> = {};
    for (const entry of rawEducation) {
        const key = `${entry.degree.toLowerCase().trim()}-${entry.institution.toLowerCase().trim()}`;
        if (!eduDedup[key]) eduDedup[key] = entry;
    }
    output.education = Object.values(eduDedup);

    // Date swap fix for education
    for (const entry of output.education) {
        if (entry.startDate && entry.endDate) {
            const sNum = parseNumericDateToken(entry.startDate);
            const eNum = parseNumericDateToken(entry.endDate);
            if (sNum > 0 && eNum > 0 && sNum > eNum) {
                const tmp = entry.startDate;
                entry.startDate = entry.endDate;
                entry.endDate = tmp;
            }
        }
    }

    // Skill relevance filter: only keep skills confirmed in resume text, cap at 15
    const relevantSkills = resumeSkills.filter(skill => fuzzySkillMatch(resumeText, skill));
    output.skills = (relevantSkills.length > 0 ? relevantSkills : resumeSkills).slice(0, 15);

    output.experience = inferExperienceFromResumeText(resumeText);

    // Date swap fix for experience
    for (const entry of output.experience) {
        if (entry.startDate && entry.endDate) {
            const sNum = parseNumericDateToken(entry.startDate);
            const eNum = parseNumericDateToken(entry.endDate);
            if (sNum > 0 && eNum > 0 && sNum > eNum) {
                const tmp = entry.startDate;
                entry.startDate = entry.endDate;
                entry.endDate = tmp;
            }
        }
    }

    output.jobRequirements.role = jdText.trim() ? (inferTitleFromText(jdText) || null) : null;
    output.jobRequirements.requiredSkills = jdSkills;
    output.jobRequirements.preferredSkills = preferredJDSkills;
    output.jobRequirements.responsibilities = inferResponsibilitiesFromJDText(jdText);

    // Use JD-aware project ranking when JD is present.
    output.projects = jdText.trim()
        ? rankProjects(allProjects, output.jobRequirements, 2)
        : allProjects.slice(0, 2);

    const requirementCount = output.jobRequirements.requiredSkills.length;
    const preferredCount = output.jobRequirements.preferredSkills.length;

    // ── Case-insensitive skill matching with synonym resolution ──
    const resumeSkillsNorm = new Set(resumeSkills.map(normalizeSkillKey));
    const matchedSkills = jdSkills.filter(skill => resumeSkillsNorm.has(normalizeSkillKey(skill)));
    const missingSkillsLocal = jdSkills.filter(skill => !resumeSkillsNorm.has(normalizeSkillKey(skill)));
    const preferredMatched = preferredJDSkills.filter(skill => resumeSkillsNorm.has(normalizeSkillKey(skill)));
    const requiredCoverage = requirementCount > 0 ? matchedSkills.length / requirementCount : 0;
    const preferredCoverage = preferredCount > 0 ? preferredMatched.length / preferredCount : 0;

    // ── Experience bonus (token-based matching) ──
    let expBonus = 0;
    const expTokens = output.experience
        .map(e => `${e.role} ${e.company} ${e.description}`)
        .join(' ').toLowerCase().split(/\W+/).filter(Boolean);
    for (const skill of jdSkills) {
        if (expTokens.includes(normalizeSkillKey(skill))) expBonus += 1;
    }
    expBonus = Math.min(expBonus * 2, 10);

    const calculatedScore =
        requirementCount > 0 || preferredCount > 0
            ? (requiredCoverage * 70) + (preferredCoverage * 15) + expBonus + (output.projects.length > 0 ? 5 : 0)
            : (matchedSkills.length > 0 ? 65 : 0);

    output.matchInsights.matchScore = clampScore(calculatedScore);
    output.matchInsights.matchedSkills = uniqueStrings([...matchedSkills, ...preferredMatched]);
    output.matchInsights.missingSkills = missingSkillsLocal;
    output.matchInsights.strongProjects = output.projects
        .filter(project => {
            const techs = (project.technologies || []).map(t => normalizeSkillKey(t));
            return techs.some(t => jdSkills.map(s => normalizeSkillKey(s)).includes(t));
        })
        .map(project => project.title)
        .filter(Boolean)
        .slice(0, 3);
    output.matchInsights.weakAreas = missingSkillsLocal.length
        ? [`Missing required skills: ${missingSkillsLocal.slice(0, 5).join(', ')}`]
        : [];
    output.matchInsights.talkingPoints = matchedSkills.length
        ? [
            `Highlight proven skills: ${matchedSkills.slice(0, 6).join(', ')}`,
            output.matchInsights.strongProjects.length > 0
                ? `Leverage project experience from ${output.matchInsights.strongProjects.join(', ')}.`
                : 'Demonstrate readiness with concrete project outcomes.',
          ]
        : ['Emphasize fast learning and directly map prior work to JD responsibilities.'];

    return output;
}

function normalizeDashboardExtraction(
    data: any,
    resumeText: string,
    jdText: string
): DashboardExtractionResult {
    const output = emptyDashboardExtraction();

    const inferredProjects = inferProjectsFromResumeText(resumeText);
    const inferredExperience = inferExperienceFromResumeText(resumeText);

    // ── PROJECTS ────────────────────────────────
    // Accept both `projects` (new spec) and `featuredProjects` (legacy LLM output)
    const rawProjects = safeArray(data?.projects || data?.featuredProjects);
    const parsedProjects = normalizeProjectCollection(rawProjects);
    const allCandidateProjects = mergeProjectCollections(inferredProjects, parsedProjects);

    // ── EDUCATION ───────────────────────────────
    // Accept both `education` (new spec) and `academicBackground` (legacy LLM output)
    const rawEducation = data?.education || data?.academicBackground;
    const education = normalizeAcademicEntryDates(mergeAcademicBackgroundEntries(rawEducation, resumeText));

    // ── EXPERIENCE ──────────────────────────────
    const parsedExperience = safeArray(data?.experience)
        .map((item: any) => {
            const role = lineClamp(toString(item?.role), 80);
            const company = lineClamp(toString(item?.company), 80);
            const rawStartDate = toString(item?.startDate || item?.start_date) || null;
            const rawEndDate = toString(item?.endDate || item?.end_date);
            const isPresent = item?.isPresent === true || /present|current|ongoing/i.test(rawEndDate) || (!!rawStartDate && !rawEndDate);
            const endDate = isPresent ? null : (rawEndDate || null);
            const rawDuration = toString(item?.duration);
            const duration = computeExperienceDuration(rawDuration, rawStartDate || undefined, endDate || undefined) || rawDuration;
            const description = lineClamp(toString(item?.description), 200);
            return { role, company, startDate: rawStartDate, endDate, isPresent, duration, description };
        })
        .filter((item: any) => item.role || item.company || item.description);

    // Dedup experience by role+company
    const expDedup = new Set<string>();
    const dedupedExperience = (parsedExperience.length > 0 ? parsedExperience : inferredExperience)
        .filter((item: any) => {
            const key = `${(item.role || '').toLowerCase()}|${(item.company || '').toLowerCase()}`;
            if (expDedup.has(key)) return false;
            expDedup.add(key);
            return true;
        });

    // ── SKILLS ──────────────────────────────────
    const skills = normalizeSkillList(data?.skills);
    const inferredResumeSkills = normalizeSkillList(inferSkillsFromText(resumeText));
    // Cap at 20 per strict spec
    const mergedResumeSkills = uniqueStrings([...skills, ...inferredResumeSkills]).slice(0, 20);

    // ── JOB REQUIREMENTS ────────────────────────
    const inferredRequiredSkills = inferRequiredSkillsFromJDText(jdText);
    const inferredPreferredSkills = inferPreferredSkillsFromJDText(jdText);

    const jobRequirements: DashboardExtractionResult['jobRequirements'] = {
        role: jdText.trim() ? (lineClamp(toString(data?.jobRequirements?.role), 100) || inferTitleFromText(jdText) || null) : null,
        requiredSkills: normalizeSkillList(data?.jobRequirements?.requiredSkills),
        preferredSkills: inferredPreferredSkills, // deterministically inferred, not from LLM
        responsibilities: uniqueStrings(
            toStringArray(data?.jobRequirements?.responsibilities)
                .map(item => lineClamp(item, 180))
        ).slice(0, 12),
    };

    if (jobRequirements.requiredSkills.length === 0) {
        jobRequirements.requiredSkills = inferredRequiredSkills;
    }

    if (jobRequirements.responsibilities.length === 0) {
        jobRequirements.responsibilities = inferResponsibilitiesFromJDText(jdText);
    }

    // ── PROJECT RANKING ────────────────────────
    const rankedProjects = jdText.trim()
        ? rankProjects(allCandidateProjects, jobRequirements, 2)
        : allCandidateProjects.slice(0, 2);

    // ── DETERMINISTIC MATCH INSIGHTS ───────────
    const resumeSkillSet = new Set(mergedResumeSkills.map(normalizeSkillKey));
    const matchedRequired = jobRequirements.requiredSkills.filter(skill => resumeSkillSet.has(normalizeSkillKey(skill)));
    const matchedPreferred = jobRequirements.preferredSkills.filter(skill => resumeSkillSet.has(normalizeSkillKey(skill)));
    const matchedSkills = uniqueStrings([...matchedRequired, ...matchedPreferred]);

    const missingSkills = jobRequirements.requiredSkills.filter(skill => !resumeSkillSet.has(normalizeSkillKey(skill)));

    const requiredCoverage = jobRequirements.requiredSkills.length > 0
        ? matchedRequired.length / jobRequirements.requiredSkills.length
        : 0;
    const preferredCoverage = jobRequirements.preferredSkills.length > 0
        ? matchedPreferred.length / jobRequirements.preferredSkills.length
        : 0;

    let experienceBonus = 0;
    const expTokens = dedupedExperience
        .map(e => `${e.role} ${e.company} ${e.description}`)
        .join(' ').toLowerCase().split(/\W+/).filter(Boolean);
    for (const skill of jobRequirements.requiredSkills) {
        if (expTokens.includes(normalizeSkillKey(skill))) experienceBonus += 1;
    }
    experienceBonus = Math.min(experienceBonus * 2, 10);

    // Compute match score deterministically (do NOT trust LLM-provided score)
    const computed = computeMatchScore({ resumeSkills: mergedResumeSkills, jdSkills: jobRequirements.requiredSkills || [], jdText });
    const matchScore = computed === null ? null : clampScore(computed);
    const numericMatchScore = matchScore === null ? 0 : matchScore;

    // ── EXPLAINABILITY: build simple + / - skill lines for UI
    const explainLines: string[] = [];
    // Required skills matched
    matchedRequired.forEach(s => explainLines.push(`+ ${s} matched`));
    // Preferred matches (that are not already listed)
    matchedPreferred.forEach(s => {
        if (!matchedRequired.includes(s)) explainLines.push(`+ ${s} (preferred) matched`);
    });
    // Missing required skills
    missingSkills.forEach(s => explainLines.push(`- ${s} missing`));

    // ── SUGGESTIONS: propose top missing skills (up to 2) and estimate score uplift
    const suggestions: Array<{ skills: string[]; estimatedIncrease: number; text: string }> = [];
    try {
        const reqCount = Math.max(1, jobRequirements.requiredSkills.length || 0);
        if (missingSkills.length > 0 && reqCount > 0) {
            const topMissing = missingSkills.slice(0, 2);
            const newScore = clampScore(Math.round(((matchedRequired.length + topMissing.length) / reqCount) * 100));
            const estimatedIncrease = Math.max(0, newScore - numericMatchScore);
            if (estimatedIncrease > 0) {
                suggestions.push({ skills: topMissing, estimatedIncrease, text: `Learn ${topMissing.join(' + ')} to improve score by +${estimatedIncrease}%` });
            }

            // Also include single-skill alternatives for the first two missing skills
            for (let i = 0; i < Math.min(2, missingSkills.length); i++) {
                const s = missingSkills[i];
                const newScoreSingle = clampScore(Math.round(((matchedRequired.length + 1) / reqCount) * 100));
                const est = Math.max(0, newScoreSingle - numericMatchScore);
                if (est > 0) suggestions.push({ skills: [s], estimatedIncrease: est, text: `Learn ${s} to improve score by +${est}%` });
            }
        }
    } catch (e) {
        // best-effort only
    }

    // ── STRONG PROJECTS ────────────────────────
    const strongProjects = rankedProjects
        .filter(project => {
            const projectSkillOverlap = project.technologies.filter(skill =>
                jobRequirements.requiredSkills.map(normalizeSkillKey).includes(normalizeSkillKey(skill)) ||
                jobRequirements.preferredSkills.map(normalizeSkillKey).includes(normalizeSkillKey(skill))
            );
            return projectSkillOverlap.length > 0;
        })
        .map(project => project.title)
        .filter(Boolean)
        .slice(0, 3);

    // ── WEAK AREAS ─────────────────────────────
    const computedWeakAreas: string[] = [];
    if (missingSkills.length > 0) {
        computedWeakAreas.push(`Missing required skills: ${missingSkills.slice(0, 5).join(', ')}`);
    }
    if (missingSkills.length > 3) {
        computedWeakAreas.push(`Significant skill gap — ${missingSkills.length} required technologies not found in resume.`);
    }
    if (dedupedExperience.length === 0) {
        computedWeakAreas.push('No experience entries detected — consider adding professional/project experience.');
    }

    // ── TALKING POINTS ─────────────────────────
    const computedTalkingPoints = uniqueStrings([
        matchedSkills.length > 0
            ? `Lead with proven expertise: ${matchedSkills.slice(0, 6).join(', ')}`
            : '',
        strongProjects.length > 0
            ? `Showcase project outcomes from ${strongProjects.join(', ')} — directly tie to ${jobRequirements.role || 'the target role'} expectations.`
            : 'Use measurable outcomes from experience to bridge any tooling gaps.',
        missingSkills.length > 0
            ? `Prepare a concrete learning plan for: ${missingSkills.slice(0, 3).join(', ')}.`
            : 'Reinforce depth in matched technologies with concrete impact metrics.',
        dedupedExperience.length > 0 && numericMatchScore >= 50
            ? `Emphasize ${dedupedExperience.length} role${dedupedExperience.length > 1 ? 's' : ''} of relevant experience to demonstrate trajectory.`
            : '',
        numericMatchScore < 40
            ? 'Focus on transferable skills and quick-ramp-up narrative for the interview.'
            : '',
    ].filter(Boolean));

    // ── FINAL SANITY LAYER ──────────────────────
    // 1. Hard dedup education by normalized degree+institution (post-normalization guard)
    const eduDedup: Record<string, typeof education[number]> = {};
    for (const entry of education) {
        const key = `${entry.degree.toLowerCase().trim()}-${entry.institution.toLowerCase().trim()}`;
        if (!eduDedup[key]) eduDedup[key] = entry;
    }
    const finalEducation = Object.values(eduDedup);

    // 2. Date swap fix: if startDate > endDate numerically, swap them
    for (const entry of finalEducation) {
        if (entry.startDate && entry.endDate) {
            const sNum = parseNumericDateToken(entry.startDate);
            const eNum = parseNumericDateToken(entry.endDate);
            if (sNum > 0 && eNum > 0 && sNum > eNum) {
                const tmp = entry.startDate;
                entry.startDate = entry.endDate;
                entry.endDate = tmp;
            }
        }
    }

    // 3. Date swap fix for experience too
    for (const entry of dedupedExperience) {
        if (entry.startDate && entry.endDate) {
            const sNum = parseNumericDateToken(entry.startDate);
            const eNum = parseNumericDateToken(entry.endDate);
            if (sNum > 0 && eNum > 0 && sNum > eNum) {
                const tmp = entry.startDate;
                entry.startDate = entry.endDate;
                entry.endDate = tmp;
            }
        }
    }

    // 4. Skill relevance filter: only keep skills confirmed in resume text, cap at 15
    const resumeLower = resumeText.toLowerCase();
    const relevantSkills = mergedResumeSkills.filter(skill =>
        resumeLower.includes(skill.toLowerCase())
    );
    const finalSkills = (relevantSkills.length > 0 ? relevantSkills : mergedResumeSkills).slice(0, 15);

    output.projects = rankedProjects;
    output.education = finalEducation;
    output.skills = finalSkills;
    output.experience = dedupedExperience;
    output.jobRequirements = jobRequirements;
    output.matchInsights = {
        matchScore,
        matchedSkills,
        missingSkills,
        strongProjects: uniqueStrings(strongProjects).slice(0, 5),
        weakAreas: uniqueStrings(computedWeakAreas).slice(0, 6),
        talkingPoints: uniqueStrings(computedTalkingPoints).slice(0, 6),
        explain: explainLines,
        suggestions,
    };

    return output;
}

export async function extractDashboardData(
    _resumeText: string,
    _jdText: string,
    _generateContentFn: (contents: any[]) => Promise<string>
): Promise<DashboardExtractionResult> {
    const rawResumeText = typeof _resumeText === 'string' ? _resumeText : '';
    const rawJdText = typeof _jdText === 'string' ? _jdText : '';
    const resumeText = rawResumeText.trim();
    const jdText = rawJdText.trim();

    if (!resumeText && !jdText) {
        const output = emptyDashboardExtraction();
        output.debug = buildDebugInfo(rawResumeText, rawJdText, output);
        return output;
    }

    // ══════════════════════════════════════════════
    // STEP 1: DETERMINISTIC EXTRACTION FIRST
    // These run BEFORE any LLM call. This is the
    // baseline that must ALWAYS produce results.
    // ══════════════════════════════════════════════
    const deterministicBase = {
        skills: extractSkillsFromText(resumeText),
        projects: extractProjectsFromText(resumeText),
        education: extractEducationFromText(resumeText),
        experience: inferExperienceFromResumeText(resumeText),
        jobRequirements: {
            requiredSkills: inferRequiredSkillsFromJDText(jdText),
            preferredSkills: inferPreferredSkillsFromJDText(jdText),
            responsibilities: inferResponsibilitiesFromJDText(jdText),
            role: jdText ? (inferTitleFromText(jdText) || null) : null,
        },
    };

    console.log('[StructuredExtractor] Deterministic baseline:', {
        skills: deterministicBase.skills.length,
        projects: deterministicBase.projects.length,
        education: deterministicBase.education.length,
        experience: deterministicBase.experience.length,
        jdSkills: deterministicBase.jobRequirements.requiredSkills.length,
    });

    // Start with deterministic data as our "parsed" result
    let parsed: any = {
        skills: [...deterministicBase.skills],
        projects: [...deterministicBase.projects],
        education: [...deterministicBase.education],
        experience: [...deterministicBase.experience],
        jobRequirements: { ...deterministicBase.jobRequirements },
        matchInsights: {},
    };

    // ══════════════════════════════════════════════
    // STEP 2: LLM ENHANCEMENT (best-effort)
    // LLM output SUPPLEMENTS deterministic data.
    // If LLM fails or returns garbage, deterministic
    // data is preserved.
    // ══════════════════════════════════════════════
    const prompt = buildDashboardExtractionPrompt(resumeText, jdText);
    let llmParsed: any = null;

    try {
        const fullPrompt = `${prompt}\n\nRESUME:\n${resumeText}\n\nJD:\n${jdText || 'Not provided'}`;
        const rawResponse = await _generateContentFn([{ text: fullPrompt }]);
        llmParsed = safeParse(rawResponse);
        if (!llmParsed) {
            console.warn('[StructuredExtractor] LLM JSON parse failed, using deterministic data only.');
        }
    } catch (error: any) {
        console.warn('[StructuredExtractor] Dashboard extraction LLM call failed, using deterministic data:', error?.message || error);
        // llmParsed remains null — deterministic data is preserved
    }

    // ══════════════════════════════════════════════
    // STEP 3: SAFE MERGE
    // Only update fields from LLM IF the LLM result
    // is BETTER (more data) than deterministic.
    // NEVER overwrite good data with worse data.
    // ══════════════════════════════════════════════
    if (llmParsed) {
        // Skills: only accept if LLM returned MORE skills
        if (Array.isArray(llmParsed.skills) && llmParsed.skills.length >= parsed.skills.length) {
            parsed.skills = llmParsed.skills;
        }

        // Projects: DO NOT let the dashboard LLM overwrite parsed projects when
        // deterministic/structured data already exists. Only accept LLM projects
        // if we have no parsed projects (preserve single source of truth).
        if (Array.isArray(llmParsed.projects) && parsed.projects.length === 0 && llmParsed.projects.length > 0) {
            parsed.projects = mergeProjectCollections(parsed.projects, llmParsed.projects);
        }

        // Education: DO NOT let the dashboard LLM overwrite parsed education when
        // deterministic/structured data already exists. Only accept LLM education
        // if we have no parsed education entries.
        if (Array.isArray(llmParsed.education) && parsed.education.length === 0 && llmParsed.education.length > 0) {
            parsed.education = llmParsed.education;
        }

        // Experience: only accept if LLM returned MORE experience entries
        if (Array.isArray(llmParsed.experience) && llmParsed.experience.length > parsed.experience.length) {
            parsed.experience = llmParsed.experience;
        }

        // JobRequirements: merge subfields selectively
        if (llmParsed.jobRequirements) {
            const llmJR = llmParsed.jobRequirements;
            if (Array.isArray(llmJR.requiredSkills) && llmJR.requiredSkills.length > (parsed.jobRequirements.requiredSkills?.length || 0)) {
                parsed.jobRequirements.requiredSkills = llmJR.requiredSkills;
            }
            if (Array.isArray(llmJR.responsibilities) && llmJR.responsibilities.length > (parsed.jobRequirements.responsibilities?.length || 0)) {
                parsed.jobRequirements.responsibilities = llmJR.responsibilities;
            }
            if (llmJR.role && !parsed.jobRequirements.role) {
                parsed.jobRequirements.role = llmJR.role;
            }
        }

        console.log('[StructuredExtractor] After safe merge with LLM:', {
            skills: parsed.skills.length,
            projects: parsed.projects.length,
            education: parsed.education.length,
        });
    }

    // ══════════════════════════════════════════════
    // STEP 4: HARD DEDUPLICATION (after all merging)
    // ══════════════════════════════════════════════
    parsed.education = dedupeEducation(parsed.education);

    // ══════════════════════════════════════════════
    // STEP 5: BLOCK GARBAGE DATA
    // ══════════════════════════════════════════════
    parsed.education = blockGarbageEducation(parsed.education);

    // Targeted retry removed: rely on deterministic extraction + safe LLM merge only.

    // ══════════════════════════════════════════════
    // STEP 7: Normalize, dedupe skills, cleanup
    // ══════════════════════════════════════════════
    // Normalize skills for display: map to canonical names where possible
    if (Array.isArray(parsed.skills)) {
        const canonical = parsed.skills
            .map((s: any) => {
                const raw = String(s || '');
                const key = normalizeSkillKey(raw);
                const mapped = SKILL_CANONICAL_MAP[key] || SKILL_CANONICAL_MAP[raw.toLowerCase()] || toTitleCase(key);
                return mapped;
            })
            .filter(Boolean);
        parsed.skills = Array.from(new Set(canonical));
    }

    // Final dedup on education after all merges
    parsed.education = dedupeEducation(blockGarbageEducation(parsed.education || []));

    // Force JD skill extraction if still missing
    if ((!parsed.jobRequirements?.requiredSkills?.length) && jdText) {
        parsed.jobRequirements = parsed.jobRequirements || {};
        parsed.jobRequirements.requiredSkills = extractSkillsFromText(jdText);
    }

    // Normalize education years
    if (Array.isArray(parsed.education)) {
        parsed.education = parsed.education.map((e: any) => {
            let s = (e?.startDate && String(e.startDate).match(/\d{4}/)?.[0]) || null;
            let end = (e?.endDate && String(e.endDate).match(/\d{4}/)?.[0]) || null;
            if (s && end) {
                const sY = parseInt(s, 10);
                const eY = parseInt(end, 10);
                if (!isNaN(sY) && !isNaN(eY) && sY > eY) {
                    // Swap if dates are reversed (defensive safety)
                    [s, end] = [end, s];
                }
            }
            return {
                ...e,
                startDate: s,
                endDate: end,
            };
        });
    }

    // Safe guard: ensure we have at least something for skills
    if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
        parsed.skills = deterministicBase.skills.length > 0 ? deterministicBase.skills : ['javascript'];
    }

    // Field-level confidence
    const fieldConfidence = {
        skills: Array.isArray(parsed.skills) && parsed.skills.length >= 5 ? 90 : 50,
        projects: Array.isArray(parsed.projects) && parsed.projects.length > 0 ? 85 : 40,
        education: Array.isArray(parsed.education) && parsed.education.length > 0 ? 80 : 40,
        experience: Array.isArray(parsed.experience) && parsed.experience.length > 0 ? 80 : 30,
    };
    console.log('🔥 FIELD CONFIDENCE:', fieldConfidence);

    // ══════════════════════════════════════════════
    // NORMALIZE + FINAL SANITY
    // ══════════════════════════════════════════════
    try {
        const normalized = normalizeDashboardExtraction(parsed, resumeText, jdText);
        normalized.debug = buildDebugInfo(rawResumeText, rawJdText, normalized);

        // Attach field-level confidence for UI badges
        try {
            (normalized as any).fieldConfidence = fieldConfidence;
        } catch (e) { /* ignore */ }

        // STEP 9: Final sanity layer
        const sanitized = finalSanityLayer(normalized);

        // Prevent empty output: force deterministic fallbacks if everything is empty
        if ((!sanitized.skills || sanitized.skills.length === 0)
            && (!sanitized.projects || sanitized.projects.length === 0)
            && (!sanitized.education || sanitized.education.length === 0)) {
            console.warn('⚠️ Empty output → forcing deterministic fallback');
            sanitized.skills = deterministicBase.skills;
            sanitized.projects = deterministicBase.projects.slice(0, 2);
            sanitized.education = deterministicBase.education;
            sanitized.debug = buildDebugInfo(rawResumeText, rawJdText, sanitized);
        }

        return sanitized;
    } catch (error: any) {
        console.error('[StructuredExtractor] Failed to normalize dashboard extraction JSON:', error?.message || error);
        const fallback = fallbackDashboardExtractionFromText(resumeText, jdText);
        fallback.debug = buildDebugInfo(rawResumeText, rawJdText, fallback);
        return finalSanityLayer(fallback);
    }
}

function inferLevelFromText(rawText: string): StructuredJD['level'] {
    const lower = rawText.toLowerCase();
    if (/\bintern(ship)?\b/.test(lower)) return 'intern';
    if (/\b(entry|fresher|junior|0-2 years|0\s*to\s*2\s*years)\b/.test(lower)) return 'entry';
    if (/\b(principal)\b/.test(lower)) return 'principal';
    if (/\bstaff\b/.test(lower)) return 'staff';
    if (/\b(senior|lead|5\+\s*years|6\+\s*years)\b/.test(lower)) return 'senior';
    return 'mid';
}

function inferEmploymentTypeFromText(rawText: string): StructuredJD['employment_type'] {
    const lower = rawText.toLowerCase();
    if (/\bintern(ship)?\b/.test(lower)) return 'internship';
    if (/\bcontract\b/.test(lower)) return 'contract';
    if (/\bpart[\s-]?time\b/.test(lower)) return 'part_time';
    return 'full_time';
}

function inferMinYearsFromText(rawText: string): number {
    const direct = rawText.match(/(\d{1,2})\s*\+?\s*(?:years|yrs)\s*(?:of)?\s*experience/i);
    if (direct?.[1]) return Number(direct[1]);

    const range = rawText.match(/(\d{1,2})\s*[-to]{1,3}\s*(\d{1,2})\s*(?:years|yrs)/i);
    if (range?.[2]) return Number(range[2]);

    return 0;
}

function normalizeLineItem(line: string): string {
    return line
        .replace(/^[-*•\d.)\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickLinesBySignals(rawText: string, signals: RegExp[], limit: number): string[] {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => normalizeLineItem(line))
        .filter(Boolean)
        .filter(line => line.length >= 8 && line.length <= 220);

    const selected = lines.filter(line => signals.some(signal => signal.test(line))).slice(0, limit);
    return Array.from(new Set(selected));
}

function fallbackJDFromText(rawText: string): StructuredJD {
    const technologies = inferSkillsFromText(rawText);
    const requirements = pickLinesBySignals(rawText, [
        /required/i,
        /qualification/i,
        /must have/i,
        /experience with/i,
        /proficient/i,
        /knowledge of/i,
    ], 12);

    const responsibilities = pickLinesBySignals(rawText, [
        /responsib/i,
        /you will/i,
        /design/i,
        /develop/i,
        /build/i,
        /maintain/i,
        /collaborat/i,
        /implement/i,
    ], 12);

    const niceToHaves = pickLinesBySignals(rawText, [
        /nice to have/i,
        /preferred/i,
        /good to have/i,
        /plus/i,
    ], 8);

    const compactSummary = rawText.replace(/\s+/g, ' ').trim().slice(0, 420);
    const title = inferTitleFromText(rawText) || 'Unknown Title';
    const company = inferCompanyFromText(rawText) || 'Unknown Company';
    const location = inferLocationFromText(rawText) || 'Unknown Location';

    return {
        title,
        company,
        location,
        description_summary: compactSummary,
        level: inferLevelFromText(rawText),
        employment_type: inferEmploymentTypeFromText(rawText),
        min_years_experience: inferMinYearsFromText(rawText),
        compensation_hint: '',
        requirements,
        nice_to_haves: niceToHaves,
        responsibilities,
        technologies,
        keywords: Array.from(new Set([...technologies, ...requirements.slice(0, 6)])),
    };
}

function fallbackResumeFromText(rawText: string): StructuredResume {
    const lines = rawText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const email = rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    const phone = rawText.match(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/)?.[0] || '';
    const linkedin = rawText.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0] || '';
    const github = rawText.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i)?.[0] || '';

    const firstLine = lines[0] || '';
    const name =
        firstLine &&
        firstLine.length <= 60 &&
        !/@/.test(firstLine) &&
        /^[A-Za-z][A-Za-z\s.'-]+$/.test(firstLine)
            ? firstLine
            : '';

    const summary = lines.slice(0, 3).join(' ').slice(0, 320);

    return {
        identity: {
            name,
            email,
            phone,
            location: '',
            linkedin,
            github,
            website: '',
            summary,
        },
        skills: inferSkillsFromText(rawText),
        experience: [],
        projects: [],
        education: [],
        achievements: [],
        certifications: [],
        leadership: [],
    };
}

function fallbackStructuredData<T>(rawText: string, type: DocType): T {
    if (type === DocType.JD) {
        return fallbackJDFromText(rawText) as unknown as T;
    }
    return fallbackResumeFromText(rawText) as unknown as T;
}

export async function extractStructuredData<T>(
    _rawText: string,
    _type: DocType,
    _generateContentFn: (contents: any[]) => Promise<string>
): Promise<T> {
    const rawText = _rawText || '';
    if (!rawText.trim()) {
        throw new Error('No text extracted from the document.');
    }

    const prompt = _type === DocType.JD
        ? buildJDPrompt(rawText)
        : buildResumePrompt(rawText);

    let rawResponse = '';
    try {
        rawResponse = await _generateContentFn([{ text: prompt }]);
    } catch (error: any) {
        console.warn('[StructuredExtractor] Structured LLM extraction failed, using deterministic fallback:', error?.message || error);
        return fallbackStructuredData<T>(rawText, _type);
    }

    try {
        let parsedRaw: any = safeParse(rawResponse) || {};

        if (_type === DocType.JD) {
            let normalized = normalizeJD(parsedRaw);
            const inferredCompany = normalized.company || inferCompanyFromText(rawText);
            const inferredTitle = normalized.title || inferTitleFromText(rawText);
            const inferredLocation = normalized.location || inferLocationFromText(rawText);

            normalized = {
                ...normalized,
                company: inferredCompany || normalized.company,
                title: inferredTitle || normalized.title,
                location: inferredLocation || normalized.location,
            };

            if (!normalized.company || !normalized.title || !normalized.location) {
                const llmFields = await inferJDFieldsWithLLM(rawText, _generateContentFn);
                normalized = {
                    ...normalized,
                    company: normalized.company || llmFields.company,
                    title: normalized.title || llmFields.title,
                    location: normalized.location || llmFields.location,
                };
            }
            return normalized as unknown as T;
        }

        // Resume: merge LLM output with deterministic fallback so partial LLM outputs
        // do not overwrite inferred/rescued data from deterministic heuristics.
        const fallback = {
            skills: inferSkillsFromText(rawText),
            projects: inferProjectsFromResumeText(rawText),
            education: inferAcademicBackgroundFromResumeText(rawText),
            experience: inferExperienceFromResumeText(rawText),
        };

        const merged = {
            skills: Array.isArray(parsedRaw.skills) && parsedRaw.skills.length ? parsedRaw.skills : fallback.skills,
            projects: Array.isArray(parsedRaw.projects) && parsedRaw.projects.length
                ? mergeProjectCollections(fallback.projects, parsedRaw.projects)
                : fallback.projects,
            education: Array.isArray(parsedRaw.education) && parsedRaw.education.length ? parsedRaw.education : fallback.education,
            experience: Array.isArray(parsedRaw.experience) && parsedRaw.experience.length ? parsedRaw.experience : fallback.experience,
            identity: parsedRaw.identity || {},
            achievements: parsedRaw.achievements || [],
            certifications: parsedRaw.certifications || [],
            leadership: parsedRaw.leadership || [],
        };

        const normalized = normalizeResume(merged);

        console.log('✅ FINAL SKILLS:', normalized.skills);
        console.log('✅ FINAL PROJECTS:', normalized.projects.length);
        console.log('✅ FINAL EDUCATION:', normalized.education.length);

        return normalized as unknown as T;
    } catch (error: any) {
        console.error('[StructuredExtractor] Failed to parse structured JSON:', error?.message || error);
        return fallbackStructuredData<T>(rawText, _type);
    }
}

/**
 * Deterministic dashboard extraction that does NOT call any LLM.
 * Use this as a fallback when the LLM is unavailable (e.g. rate-limited).
 */
export function extractDashboardDataDeterministic(
    resumeText: string,
    jdText: string
): DashboardExtractionResult {
    const resume = typeof resumeText === 'string' ? resumeText.trim() : '';
    const jd = typeof jdText === 'string' ? jdText.trim() : '';

    if (!resume && !jd) {
        const output = emptyDashboardExtraction();
        output.debug = buildDebugInfo(resume, jd, output);
        return output;
    }

    const fallback = fallbackDashboardExtractionFromText(resume, jd);
    fallback.debug = buildDebugInfo(resume, jd, fallback);
    return finalSanityLayer(fallback);
}
