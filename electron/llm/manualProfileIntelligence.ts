// electron/llm/manualProfileIntelligence.ts
// Deterministic fast-path profile answering.
// When the user's question matches a known profile-fact pattern (name,
// experience, projects, skills, education, JD fit), this module builds
// the answer directly from structured profile data WITHOUT calling the LLM.
// Used by both manual-input and live-transcript (what_to_answer) flows.

import { createHash } from 'crypto';

/* ── Helpers ──────────────────────────────────────────────── */

const normalize = (question: string): string =>
  question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const hasAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some(pattern => pattern.test(text));

const asArray = (value: unknown): any[] =>
  Array.isArray(value) ? value.filter(Boolean) : [];

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const firstNonEmpty = (...values: unknown[]): string =>
  values.map(clean).find(Boolean) || '';

/* ── Pattern Sets ─────────────────────────────────────────── */

const ASSISTANT_IDENTITY_PATTERNS = [
  /^(who|what)\s+(are|r)\s+(you|u)\b/,
  /^are\s+you\s+(an?\s+)?(ai|assistant|bot|llm|model)\b/,
  /^what\s+is\s+natively\b/,
  /^who\s+(made|built|created|developed|trained)\s+(you|this|natively)\b/,
  /^what\s+model\s+(are\s+you|do\s+you\s+use)\b/,
  /^what\s+is\s+your\s+name\b/,
  /^what\s+s\s+your\s+name\b/,
];

const NAME_PATTERNS = [
  /\bwhat\s+is\s+my\s+name\b/,
  /\bwhat\s+s\s+my\s+name\b/,
  /\bwho\s+am\s+i\b/,
  /\bstate\s+my\s+name\b/,
  /\bwhat\s+(is|s)\s+your\s+(full\s+)?name\b/,
  /\bwhat\s+should\s+(i|we)\s+call\s+you\b/,
  /\bwho\s+are\s+you\b/,
  /\bstate\s+your\s+name\b/,
  /\bcan\s+you\s+(tell\s+me\s+)?your\s+name\b/,
];

const EXPERIENCE_PATTERNS = [
  /\b(my|your)\s+experiences?\b/,
  /\bexperience\s+do\s+i\s+have\b/,
  /\bwork\s+experience\b/,
  /\bwork\s+history\b/,
  /\bprevious\s+roles?\b/,
  /\b(?<!educational\s)(?<!education\s)background\b/,
  /\bwhat\s+do\s+(you|i)\s+(currently|now)\s*do\b/,
  /\bwhat\s+(are|r)\s+(you|u)\s+(currently\s+)?working\s+on\b/,
  /\bwhat(?:'s| is)\s+(your|my)\s+current\s+(role|job|position|title)\b/,
  /\bwhat\s+companies?\s+have\s+(you|i)\s+worked\b/,
  /\bwhere\s+have\s+(you|i)\s+worked\b/,
];

const INTRO_PATTERNS = [
  /\btell\s+me\s+about\s+(yourself|your\s*self)\b/,
  /\b(give|tell)\s+(me\s+)?(a\s+)?(quick|brief|short)?\s*(introduction|intro|overview of yourself|rundown)\b/,
  /\b(can\s+you\s+)?(quickly\s+)?introduce\s+yourself\b/,
  /\bdescribe\s+yourself\b/,
  /\bhow\s+(would|do)\s+you\s+describe\s+yourself\b/,
  /\bsummari[sz]e\s+who\s+you\s+are\b/,
  /\b(walk\s+me\s+through|tell\s+me\s+about)\s+your\s+(background|journey|career|profile)\b/,
  /\bgive\s+(me\s+)?your\s+background\b/,
  /\bwho\s+are\s+you\s+as\s+a\s+(candidate|person|professional)\b/,
];

const PROJECT_PATTERNS = [
  /\b(my|your)\s+projects?\b/,
  /\bprojects?\s+have\s+(i|you)\s+(done|built|worked\s+on|shipped)\b/,
  /\bwhat\s+all\s+projects?\b/,
  /\bthings\s+(i|you)\s+(built|shipped)\b/,
];

const SKILL_PATTERNS = [
  /\b(my|your)\s+(main\s+|technical\s+|key\s+|core\s+)?skills?\b/,
  /\bskills?\s+do\s+i\s+have\b/,
  /\btech\s+stack\b/,
  /\btools?\s+(do\s+i|have\s+you)\b/,
  /\btechnologies?\b/,
  /\bwhat\s+(programming|coding)\s+languages?\s+do\s+(you|i)\b/,
  /\bwhat\s+languages?\s+do\s+(you|i)\s+(know|use)\b/,
];

const EDUCATION_PATTERNS = [
  /\b(my|your)\s+education(al)?\b/,
  /\bwhere\s+did\s+(i|you)\s+(go\s+to\s+school|study|graduate)\b/,
  /\bdegree\b/,
  /\bschool\b/,
  /\buniversity\b/,
  /\bwhat(?:'s| is)\s+(your|my)\s+educational?\s+background\b/,
];

const ROLE_PATTERNS = [
  /\brole\s+am\s+i\s+applying\s+for\b/,
  /\bwhat\s+(job|position|role)\b.*\b(applying|targeting)\b/,
  /\btarget\s+(role|job|position)\b/,
];

const JD_FIT_PATTERNS = [
  /\bhow\s+do\s+i\s+fit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bhow\s+am\s+i\s+a\s+(fit|match)\b/,
  /\bwhy\s+am\s+i\s+a\s+(good\s+)?(fit|match)\b/,
  /\bfit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bmatch\s+(this\s+)?(jd|job|role|position)\b/,
];

/* ── Profile data extractors ──────────────────────────────── */

const profileName = (profile: any): string =>
  firstNonEmpty(profile?.identity?.name, profile?.name, profile?.personal?.name);

const jdTitle = (jd: any): string =>
  firstNonEmpty(jd?.title, jd?.role, jd?.position, jd?.jobTitle);

const jdCompany = (jd: any): string =>
  firstNonEmpty(jd?.company);

const formatInlineList = (items: string[], max = 8): string => {
  const values = items.map(clean).filter(Boolean).slice(0, max);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const profileExperience = (profile: any): any[] => asArray(profile?.experience);
const profileProjects = (profile: any): any[] => asArray(profile?.projects);
const profileEducation = (profile: any): any[] => asArray(profile?.education);

const profileSkills = (profile: any): any[] => {
  const flat = profile?.skills_flat ?? profile?.skillsFlat;
  if (Array.isArray(flat)) return flat.filter(Boolean);
  const raw = profile?.skills;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') {
    const out: any[] = [];
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) out.push(...(v as any[]).filter(Boolean));
    }
    return out;
  }
  return [];
};

/* ── Formatters ───────────────────────────────────────────── */

const formatIntro = (profile: any): string => {
  const name = profileName(profile);
  if (!name) return '';
  const exp = profileExperience(profile);
  const cur = exp[0];
  const role = cur ? firstNonEmpty(cur.role, cur.title, cur.position) : '';
  const company = cur ? firstNonEmpty(cur.company, cur.organization, cur.employer) : '';
  const skills = profileSkills(profile).map((s: any) => typeof s === 'string' ? s : firstNonEmpty(s.name, s.skill)).filter(Boolean).slice(0, 4);
  const projects = profileProjects(profile).map((p: any) => firstNonEmpty(p.name, p.title)).filter(Boolean).slice(0, 1);
  const parts: string[] = [];
  const article = role && /^[aeiou]/i.test(role.trim()) ? 'an' : 'a';
  if (role) parts.push(`I'm ${name}, ${article} ${role}${company ? ` at ${company}` : ''}.`);
  else parts.push(`I'm ${name}.`);
  if (skills.length) parts.push(`I work mainly with ${formatInlineList(skills, 4)}.`);
  if (projects.length) parts.push(`One project I'm proud of is ${projects[0]}.`);
  return parts.join(' ');
};

const formatExperience = (profile: any): string => {
  const entries = profileExperience(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 5).map((entry: any) => {
    const role = firstNonEmpty(entry.role, entry.title, entry.position);
    const company = firstNonEmpty(entry.company, entry.organization, entry.employer);
    const bullets = asArray(entry.bullets || entry.highlights || entry.responsibilities).map(clean).filter(Boolean);
    const headline = [role, company ? `at ${company}` : ''].filter(Boolean).join(' ');
    const detail = bullets[0] ? ` — ${bullets[0]}` : '';
    return headline ? `${headline}${detail}` : clean(entry);
  }).filter(Boolean);
  return lines.length ? `Your experience includes ${lines.join('; ')}.` : '';
};

const formatProjects = (profile: any): string => {
  const entries = profileProjects(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 6).map((project: any) => {
    const name = firstNonEmpty(project.name, project.title);
    const description = firstNonEmpty(project.description, project.summary);
    const tech = formatInlineList(asArray(project.technologies || project.tech_stack || project.tools).map(clean).filter(Boolean), 4);
    if (!name) return clean(project);
    return `${name}${description ? ` — ${description}` : ''}${tech ? ` (${tech})` : ''}`;
  }).filter(Boolean);
  return lines.length ? `Your projects include ${lines.join('; ')}.` : '';
};

const findProjectByName = (profile: any, q: string): any | null => {
  const entries = profileProjects(profile);
  if (!entries.length) return null;
  for (const p of entries) {
    const name = firstNonEmpty(p.name, p.title);
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (q.includes(lowerName)) return p;
    const head = lowerName.split(/[\s–—\-:|]+/).filter(Boolean)[0];
    if (head && head.length >= 4 && new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return p;
  }
  if (/\b(best|most important|strongest|main|biggest|favou?rite|top)\b/.test(q) && /\b(project|projects|work|app|product|system|build|built)\b/.test(q)) {
    return entries[0];
  }
  return null;
};

const formatSingleProject = (project: any): string => {
  const name = firstNonEmpty(project.name, project.title);
  const description = firstNonEmpty(project.description, project.summary);
  const tech = formatInlineList(asArray(project.technologies || project.tech_stack || project.tools).map(clean).filter(Boolean), 6);
  if (!name) return '';
  const parts = [`Your project ${name}`];
  if (description) parts.push(`is ${description}`);
  const head = parts.join(' ');
  return `${head}.${tech ? ` It was built with ${tech}.` : ''}`;
};

const SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|sql|nosql|mongodb|postgres(?:ql)?|redis|data analysis|analytics|machine learning|ml|statistics)\b/i;

const findProfileSkill = (profile: any, q: string): { skill: string; projects: string[] } | null => {
  const m = q.match(SKILL_TOKEN_RE);
  if (!m) return null;
  const skill = m[0];
  const all = profileSkills(profile).map((s: any) => typeof s === 'string' ? s : firstNonEmpty(s.name, s.skill)).filter(Boolean).map((s: string) => s.toLowerCase());
  const projects = profileProjects(profile).filter((p: any) => {
    const tech = asArray(p.technologies || p.tech_stack || p.tools).map((t: any) => clean(t).toLowerCase());
    const desc = firstNonEmpty(p.description, p.summary).toLowerCase();
    return tech.some((t: string) => t.includes(skill.toLowerCase())) || desc.includes(skill.toLowerCase());
  }).map((p: any) => firstNonEmpty(p.name, p.title)).filter(Boolean).slice(0, 2);
  const inSkills = all.some((s: string) => s.includes(skill.toLowerCase()) || skill.toLowerCase().includes(s));
  if (!inSkills && projects.length === 0) return null;
  return { skill, projects };
};

const formatSkillExperience = (profile: any, q: string): string => {
  const found = findProfileSkill(profile, q);
  if (!found) return '';
  const { skill, projects } = found;
  if (projects.length) {
    return `Yes, I've worked with ${skill} — I used it in ${formatInlineList(projects, 2)}.`;
  }
  return `Yes, ${skill} is one of the skills I work with.`;
};

const formatSkills = (profile: any): string => {
  const skills = profileSkills(profile).map((skill: any) => typeof skill === 'string' ? skill : firstNonEmpty(skill.name, skill.skill)).filter(Boolean);
  return skills.length ? `Your skills include ${formatInlineList(skills, 12)}.` : '';
};

const formatEducation = (profile: any): string => {
  const entries = profileEducation(profile);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 3).map((edu: any) => {
    const degree = [firstNonEmpty(edu.degree), firstNonEmpty(edu.field, edu.major)].filter(Boolean).join(' in ');
    const institution = firstNonEmpty(edu.institution, edu.school, edu.university);
    return [degree, institution ? `from ${institution}` : ''].filter(Boolean).join(' ');
  }).filter(Boolean);
  return lines.length ? `Your education includes ${lines.join('; ')}.` : '';
};

/* ── JD Fit ───────────────────────────────────────────────── */

const structuredJobTerms = (jd: any): string[] => [
  ...asArray(jd?.requirements), ...asArray(jd?.nice_to_haves),
  ...asArray(jd?.responsibilities), ...asArray(jd?.technologies),
  ...asArray(jd?.keywords),
].map(clean).filter(Boolean);

const normalizedTermSet = (terms: string[]): Set<string> => new Set(
  terms.flatMap(term => term.split(/[^a-zA-Z0-9+#.]+/g)).map(term => term.trim().toLowerCase()).filter(term => term.length >= 2),
);

const profileSkillNames = (profile: any): string[] =>
  profileSkills(profile).map((skill: any) => typeof skill === 'string' ? skill : firstNonEmpty(skill.name, skill.skill)).filter(Boolean);

const matchingSkillsForJD = (profile: any, jd: any): string[] => {
  const jdTerms = normalizedTermSet(structuredJobTerms(jd));
  return profileSkillNames(profile).filter(skill => {
    const normalizedSkill = skill.toLowerCase();
    return jdTerms.has(normalizedSkill) || normalizedSkill.split(/[^a-z0-9+#.]+/g).some(part => jdTerms.has(part));
  });
};

const formatJDFit = (profile: any, jd: any): string => {
  const title = jdTitle(jd);
  const company = jdCompany(jd);
  const matchedSkills = matchingSkillsForJD(profile, jd);
  const skills = matchedSkills.length ? matchedSkills : profileSkillNames(profile).slice(0, 3);
  const experience = profileExperience(profile);
  const projects = profileProjects(profile);
  const anchors = [
    skills.length ? `${formatInlineList(skills, 6)} ${matchedSkills.length ? 'match the role requirements' : 'are relevant resume skills'}` : '',
    experience[0] ? `${firstNonEmpty(experience[0].role, experience[0].title, experience[0].position)} experience${firstNonEmpty(experience[0].company, experience[0].organization, experience[0].employer) ? ` at ${firstNonEmpty(experience[0].company, experience[0].organization, experience[0].employer)}` : ''}` : '',
    projects[0] ? `${firstNonEmpty(projects[0].name, projects[0].title)} project work` : '',
  ].filter(Boolean);
  if (!title || !company || anchors.length === 0) return '';
  return `You fit the ${title} role at ${company} because ${anchors.join('; ')}.`;
};

/* ── Public API ───────────────────────────────────────────── */

export type ProfileSource = 'manual_input' | 'what_to_answer' | 'transcript';

export interface ManualProfileRoute {
  answer: string;
  answerType: string;
  selectedContextLayers: string[];
  excludedContextLayers: string[];
  profileFactsReady: boolean;
  usedDeterministicFastPath: boolean;
  providerUsed: boolean;
  promptContainsProfileContext?: boolean;
}

export const isAssistantIdentityQuestion = (question: string): boolean => {
  const q = normalize(question);
  return hasAny(q, ASSISTANT_IDENTITY_PATTERNS);
};

export const isCandidateProfileQuestion = (question: string): boolean => {
  if (isAssistantIdentityQuestion(question)) return false;
  const q = normalize(question);
  return hasAny(q, [
    ...NAME_PATTERNS, ...EXPERIENCE_PATTERNS, ...PROJECT_PATTERNS,
    ...SKILL_PATTERNS, ...EDUCATION_PATTERNS, ...ROLE_PATTERNS, ...JD_FIT_PATTERNS,
  ]);
};

export const profileFactsReady = (profile: any): boolean => Boolean(
  profile && (
    profileName(profile) ||
    profileExperience(profile).length > 0 ||
    profileProjects(profile).length > 0 ||
    profileSkills(profile).length > 0 ||
    profileEducation(profile).length > 0
  ),
);

const makeRoute = (answer: string, answerType: string, selectedContextLayers: string[]): ManualProfileRoute => ({
  answer, answerType, selectedContextLayers,
  excludedContextLayers: ['assistant_identity'],
  profileFactsReady: true,
  usedDeterministicFastPath: true,
  providerUsed: false,
});

/* ── Qualifier detection ──────────────────────────────────── */

const QUALIFIER_PATTERNS = [
  /\b(that|which|where|whose|who)\b.*\b(use[ds]?|using|used|built|made|involve[ds]?|with|related|based|for|require[ds]?|need[s]?)\b/,
  /\b(use[ds]?|using|used|involv\w+|relat\w+|based\s+on|about|regarding|with)\b\s+\w/,
  /\bwhich\s+(one|project|skill|role|job|experience)\b/,
  /\bany\s+(project|experience|skill)s?\b.*\b(with|using|in|for|that)\b/,
  /\b(only|just|specifically|particular|specific)\b/,
  /\b(more|most|best|top|strongest|relevant|fit)\b/,
  /\bhow\s+(did|do|have|does)\b|\bwhy\b/,
  /\bcompare|versus|vs\.?\b|\bdifference\b/,
  /\bin\s+(python|java|javascript|typescript|go|rust|c\+\+|sql|react|node|aws|gcp|azure)\b/,
];

const JD_FIT_CANONICAL = /\b(how|why)\s+(do\s+i|am\s+i|are\s+you|would\s+i)\b.*\bfit\b/;

export const hasUnhandledQualifier = (normalizedQuestion: string): boolean => {
  if (JD_FIT_CANONICAL.test(normalizedQuestion)) return false;
  return hasAny(normalizedQuestion, QUALIFIER_PATTERNS);
};

/* ── Main fast-path builder ───────────────────────────────── */

export const tryBuildManualProfileFastPathAnswer = ({
  question, profile, jobDescription, source = 'manual_input',
}: {
  question: string; profile: any; jobDescription: any; source?: ProfileSource;
}): ManualProfileRoute | null => {
  const firstPerson = source === 'what_to_answer' || source === 'transcript';
  const qNorm = normalize(question);
  if (!firstPerson && isAssistantIdentityQuestion(question)) return null;
  const q = qNorm;
  const qualified = hasUnhandledQualifier(q);

  // JD Fit
  if (hasAny(q, JD_FIT_PATTERNS) && !qualified) {
    if (!profileFactsReady(profile)) return null;
    const answer = formatJDFit(profile, jobDescription);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^You fit/i, 'I fit') : answer, 'jd_fit_answer', ['resume', 'jd']);
  }

  // Target role
  if (hasAny(q, ROLE_PATTERNS)) {
    const title = jdTitle(jobDescription);
    if (!title) return null;
    return makeRoute(
      firstPerson ? `I am applying for the ${title} role.` : `You are applying for the ${title} role.`,
      'jd_fit_answer', ['jd'],
    );
  }

  if (!profileFactsReady(profile)) return null;

  // Name
  const isNameQuestion = hasAny(q, NAME_PATTERNS) || (firstPerson && /\bwhat\s+(is|s)\s+your\s+name\b/.test(q));
  if (isNameQuestion) {
    const name = profileName(profile);
    if (!name) return null;
    return makeRoute(
      firstPerson ? `My name is ${name}.` : `Your name is ${name}.`,
      'identity_answer', ['stable_identity', 'resume'],
    );
  }

  // Intro
  if (firstPerson && hasAny(q, INTRO_PATTERNS)) {
    const intro = formatIntro(profile);
    if (intro) return makeRoute(intro, 'identity_answer', ['stable_identity', 'resume']);
  }

  // Experience
  if (hasAny(q, EXPERIENCE_PATTERNS) && !qualified) {
    const answer = formatExperience(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your experience includes/i, 'My experience includes') : answer, 'experience_answer', ['resume']);
  }

  // Named project lookup
  const isNarrativeDrillIn = /\b(how (was|is|did)|hardest|challenge|learn|your role|why did you|proud|improve|optimi[sz]e|architecture|coordinat)\b/.test(q);
  const isProjectFactAsk = /\b(tell me about|talk about|explain|describe|what(?:'s| is)?|tech ?stack|technolog|stack of|built with|made with)\b/.test(q);
  if (isProjectFactAsk && !isNarrativeDrillIn) {
    const project = findProjectByName(profile, q);
    if (project) {
      const answer = formatSingleProject(project);
      if (answer) {
        return makeRoute(
          firstPerson ? answer.replace(/^Your project/i, 'My project') : answer,
          'project_answer', ['resume', 'projects'],
        );
      }
    }
  }

  // All projects
  if (hasAny(q, PROJECT_PATTERNS) && !qualified) {
    const answer = formatProjects(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your projects include/i, 'My projects include') : answer, 'project_answer', ['resume', 'projects']);
  }

  // Skill experience
  const isSkillExperienceQ = /\b(experience\s+(with|in|using)|have\s+(you|i)\s+(used|worked\s+with)|worked\s+with|familiar\s+with)\b/.test(q) && !/\brate|out of (?:10|ten)|scale\b/.test(q);
  if (isSkillExperienceQ) {
    const answer = formatSkillExperience(profile, q);
    if (answer) return makeRoute(firstPerson ? answer : answer.replace(/^Yes, I've/i, "Yes, you've"), 'skill_experience_answer', ['resume']);
  }

  // Skills
  if (hasAny(q, SKILL_PATTERNS) && !qualified) {
    const answer = formatSkills(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your skills include/i, 'My skills include') : answer, 'skills_answer', ['resume']);
  }

  // Education
  if (hasAny(q, EDUCATION_PATTERNS) && !qualified) {
    const answer = formatEducation(profile);
    if (!answer) return null;
    return makeRoute(firstPerson ? answer.replace(/^Your education includes/i, 'My education includes') : answer, 'profile_fact_answer', ['resume']);
  }

  return null;
};

/* ── Live fallback ────────────────────────────────────────── */

export const buildLiveFallbackAnswer = ({
  question, answerType, profile, jobDescription,
}: {
  question: string; answerType: string; profile: any; jobDescription: any;
}): string | null => {
  if (!profileFactsReady(profile)) return null;
  const profileRoutes = new Set([
    'identity_answer', 'profile_fact_answer', 'project_answer',
    'project_followup_answer', 'skills_answer', 'skill_experience_answer',
    'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer',
  ]);
  if (!profileRoutes.has(answerType)) return null;
  try {
    const fp = tryBuildManualProfileFastPathAnswer({ question, profile, jobDescription, source: 'what_to_answer' });
    if (fp?.answer) return fp.answer;
  } catch { /* noop */ }
  if (answerType === 'jd_fit_answer') {
    const fit = formatJDFit(profile, jobDescription);
    if (fit) return fit.replace(/^You fit/i, 'I fit');
  }
  const intro = formatIntro(profile);
  if (intro) return intro;
  const exp = formatExperience(profile);
  if (exp) return exp.replace(/^Your experience includes/i, 'My experience includes');
  const skills = formatSkills(profile);
  if (skills) return skills.replace(/^Your skills include/i, 'My skills include');
  return null;
};

/* ── Logging ──────────────────────────────────────────────── */

export const logManualProfileRoute = ({
  source, question, route, profileFactsReady: pfReady,
}: {
  source: string; question: string; route: ManualProfileRoute | null; profileFactsReady: boolean;
}): Record<string, any> => ({
  source,
  questionHash: createHash('sha256').update(question).digest('hex').slice(0, 12),
  answerType: route?.answerType ?? 'unknown_answer',
  selectedContextLayers: route?.selectedContextLayers ?? [],
  excludedContextLayers: route?.excludedContextLayers ?? [],
  profileFactsReady: pfReady,
  usedDeterministicFastPath: route?.usedDeterministicFastPath ?? false,
  providerUsed: route?.providerUsed ?? false,
  promptContainsProfileContext: route?.promptContainsProfileContext,
});
