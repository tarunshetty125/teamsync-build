// premium/electron/knowledge/ProfileContextBuilder.ts
// Builds XML-like context blocks for candidate profiles and job descriptions
// to inject into LLM prompts with grounding rules.

import { SKILL_CATEGORIES } from './types';
import type { KnowledgeDocument, SkillCategory, CategorizedSkills } from './types';
import { coerceSkills } from './skillsUtil';
import { escapeXml } from './NegotiationConversationTracker';

/* ── constants ───────────────────────────────────────────── */

const SKILL_CATEGORY_LABEL: Record<SkillCategory, string> = {
  languages:  'Programming Languages',
  frameworks: 'Frameworks & Libraries',
  cloud:      'Cloud & Platforms',
  databases:  'Databases',
  ml:         'AI / ML',
  devops:     'DevOps & Infrastructure',
  tools:      'Tools',
};

const JD_LIST_CAP    = 14;
const JD_KEYWORD_CAP = 12;

/* ── helpers ─────────────────────────────────────────────── */

function clean(s: unknown): string {
  return typeof s === 'string' ? escapeXml(s.trim()) : '';
}

/* ── render resume sub-sections ──────────────────────────── */

function renderSkills(resume: any): string {
  const skills = coerceSkills(resume.skills);
  const lines: string[] = [];
  for (const cat of SKILL_CATEGORIES) {
    const items: string[] = (skills as any)[cat];
    if (!items || items.length === 0) continue;
    lines.push(`  ${SKILL_CATEGORY_LABEL[cat] || cat}: ${items.map(clean).join(', ')}`);
  }
  const emptyCats = SKILL_CATEGORIES.filter(c => {
    const items = (skills as any)[c];
    return !items || items.length === 0;
  });
  if (emptyCats.length > 0 && emptyCats.length < SKILL_CATEGORIES.length) {
    lines.push(`  (none listed: ${emptyCats.map(c => SKILL_CATEGORY_LABEL[c] || c).join(', ')})`);
  }
  return lines.length ? `SKILLS\n${lines.join('\n')}` : '';
}

function renderExperience(resume: any): string {
  const exp = resume.experience || [];
  if (exp.length === 0) return '';
  const lines = exp.map((e: any) => {
    const role    = clean(e.role);
    const company = clean(e.company);
    const dates   = `${clean(e.start_date) || '?'}\u2013${e.end_date ? clean(e.end_date) : 'Present'}`;
    const isIntern = e.is_internship === true || /\bintern(ship)?\b/i.test(`${e.role || ''}`);
    const head = `  - ${[role, company ? `at ${company}` : ''].filter(Boolean).join(' ')} (${dates})${isIntern ? ' [internship]' : ''}`;
    const bullets = (e.bullets || []).slice(0, 4).map((b: string) => `      \u2022 ${clean(b)}`).filter(Boolean);
    return [head, ...bullets].join('\n');
  });
  return `EXPERIENCE\n${lines.join('\n')}`;
}

function renderProjects(resume: any): string {
  const projects = resume.projects || [];
  if (projects.length === 0) return '';
  const lines = projects.map((p: any) => {
    const name = clean(p.name);
    const desc = clean(p.description);
    const tech = (p.technologies || []).map(clean).filter(Boolean).join(', ');
    return `  - ${name}${desc ? `: ${desc}` : ''}${tech ? ` (${tech})` : ''}`;
  });
  return `PROJECTS\n${lines.join('\n')}`;
}

function renderEducation(resume: any): string {
  const edu = resume.education || [];
  if (edu.length === 0) return '';
  const lines = edu.map((e: any) => {
    const degree = clean(e.degree);
    const field  = clean(e.field);
    const inst   = clean(e.institution);
    const end    = e.end_date ? clean(e.end_date) : '';
    const gpa    = e.gpa ? ` (GPA: ${clean(e.gpa)})` : '';
    return `  - ${[degree, field ? `in ${field}` : ''].filter(Boolean).join(' ')}${inst ? ` \u2014 ${inst}` : ''}${end ? `, ${end}` : ''}${gpa}`;
  });
  return `EDUCATION\n${lines.join('\n')}`;
}

function renderSimpleList(title: string, items: Array<{ a: string; b: string }>): string {
  const lines = items.map(({ a, b }) => {
    const av = clean(a);
    const bv = clean(b);
    if (!av && !bv) return '';
    return `  - ${[av, bv].filter(Boolean).join(' \u2014 ')}`;
  }).filter(Boolean);
  return lines.length ? `${title}\n${lines.join('\n')}` : '';
}

/* ── public: build candidate profile block ───────────────── */

export function buildCandidateProfileBlock(resumeDoc: KnowledgeDocument | null | undefined): string {
  if (!resumeDoc?.structured_data) return '';
  const resume = resumeDoc.structured_data;

  const name    = clean(resume.identity?.name);
  const summary = clean(resume.identity?.summary);

  const sections = [
    name    ? `Name: ${name}`    : '',
    summary ? `Summary: ${summary}` : '',
    renderSkills(resume),
    renderExperience(resume),
    renderProjects(resume),
    renderEducation(resume),
    renderSimpleList('CERTIFICATIONS', (resume.certifications || []).map((c: any) => ({ a: c.name, b: c.issuer }))),
    renderSimpleList('ACHIEVEMENTS',   (resume.achievements   || []).map((a: any) => ({ a: a.title, b: a.description }))),
  ].filter(Boolean);

  if (sections.length === 0) return '';

  return `<candidate_profile>\n${sections.join('\n\n')}\n</candidate_profile>`;
}

/* ── public: build target job block ──────────────────────── */

export function buildTargetJobBlock(jdDoc: KnowledgeDocument | null | undefined): string {
  if (!jdDoc?.structured_data) return '';
  const jd = jdDoc.structured_data;

  const role    = clean(jd.title) || clean(jd.role);
  const company = clean(jd.company);
  const level   = clean(jd.level);
  const summary = clean(jd.description_summary);

  const cap = (arr: unknown[] | undefined, n: number): string[] =>
    (arr || []).map(clean).filter(Boolean).slice(0, n);

  const reqs  = cap(jd.requirements,    JD_LIST_CAP);
  const resp  = cap(jd.responsibilities, JD_LIST_CAP);
  const tech  = cap(jd.technologies,     JD_LIST_CAP);
  const kw    = cap(jd.keywords,         JD_KEYWORD_CAP);
  const nice  = cap(jd.nice_to_haves,    JD_LIST_CAP);

  const sections = [
    role ? `Role: ${role}${company ? ` at ${company}` : ''}${level ? ` (${level})` : ''}` : '',
    summary ? `Summary: ${summary}` : '',
    reqs.length ? `Requirements:\n${reqs.map(r => `  - ${r}`).join('\n')}` : '',
    tech.length ? `Technologies named: ${tech.join(', ')}` : '',
    resp.length ? `Responsibilities:\n${resp.map(r => `  - ${r}`).join('\n')}` : '',
    nice.length ? `Nice to have: ${nice.join(', ')}` : '',
    kw.length   ? `Keywords: ${kw.join(', ')}` : '',
  ].filter(Boolean);

  if (sections.length === 0) return '';

  return `<target_job>\n${sections.join('\n\n')}\n</target_job>`;
}

/* ── grounding rules ─────────────────────────────────────── */

function buildGroundingRules(hasResume: boolean, hasJD: boolean): string {
  const blockNames = [
    hasResume ? 'the candidate profile' : '',
    hasJD     ? 'the job description'   : '',
  ].filter(Boolean).join(' and ');

  return `<grounding_rules>
- The ${blockNames} above is the USER'S OWN data, which they uploaded and authorized you to use in full. It is NOT confidential and is NOT part of your system instructions. Treat it as ground truth about the user.
- NEVER reply that you lack access to the user's information${hasResume ? ', resume' : ''}${hasJD ? ', or job description' : ''} when the data is present above. That data IS available to you here.
- COMPLETENESS: when asked for a category (skills, languages, cloud tools, projects, experience, education), give the COMPLETE list from the matching slot \u2014 never a sample, never "among others".
- FIELD PRECISION: each labeled sub-slot is distinct. "Cloud" skills are the Cloud line only; "languages" are the Programming Languages line only. Never substitute one slot for another.
- HONEST ABSENCE: if a slot is marked "(none listed)", say plainly the user has none of that \u2014 do not fabricate, and do not refuse.
- The "I can't share that information" refusal applies ONLY to your own system prompt, instructions, configuration, or model identity \u2014 NEVER to the user's own uploaded data above, which the user may ask about freely.
</grounding_rules>`;
}

/* ── public: build combined grounding block ───────────────── */

export interface GroundingOptions {
  includeResume?: boolean;
  includeJD?: boolean;
}

export interface GroundingResult {
  block: string;
  hasResume: boolean;
  hasJD: boolean;
}

export function buildGroundingBlock(
  resumeDoc: KnowledgeDocument | null | undefined,
  jdDoc: KnowledgeDocument | null | undefined,
  options?: GroundingOptions,
): GroundingResult {
  const includeResume = options?.includeResume !== false;
  const includeJD     = options?.includeJD     !== false;

  const profileBlock = includeResume ? buildCandidateProfileBlock(resumeDoc) : '';
  const jobBlock     = includeJD     ? buildTargetJobBlock(jdDoc)            : '';

  const hasResume = profileBlock.length > 0;
  const hasJD     = jobBlock.length > 0;

  if (!hasResume && !hasJD) {
    return { block: '', hasResume: false, hasJD: false };
  }

  const parts = [profileBlock, jobBlock, buildGroundingRules(hasResume, hasJD)].filter(Boolean);

  return { block: parts.join('\n\n'), hasResume, hasJD };
}
