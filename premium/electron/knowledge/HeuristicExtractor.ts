// premium/electron/knowledge/HeuristicExtractor.ts
// Fast, regex-based fallback extractor for resumes and job descriptions.
// Used when the LLM-based StructuredExtractor is unavailable or too slow.

import { SKILL_CATEGORIES, PROFILE_SCHEMA_VERSION } from './types';
import type {
  StructuredResume,
  StructuredJD,
  IdentityInfo,
  ExperienceEntry,
  ProjectEntry,
  EducationEntry,
  JDLevel,
  EmploymentType,
  CategorizedSkills,
} from './types';
import { categorizeFlatSkills, flattenSkills } from './skillsUtil';

/* ── tiny helpers ────────────────────────────────────────── */

const lines  = (text: string): string[] => (text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd());
const nonEmpty = (ls: string[]): string[] => ls.map(l => l.trim()).filter(Boolean);

const EMAIL_RE    = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE    = /(?:\+?\d[\d\s().-]{7,}\d)/;
const GITHUB_RE   = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[A-Za-z0-9_/.-]+/i;
const URL_RE      = /\bhttps?:\/\/[^\s|]+/i;

/* ── name detection ──────────────────────────────────────── */

const SECTION_WORDS = new Set([
  'resume','cv','curriculum vitae','summary','objective','profile',
  'about','skills','technical skills','experience','work experience',
  'employment','projects','education','achievements','certifications',
  'awards','interests','contact','references','leadership',
  'publications','languages',
]);

const looksLikeName = (raw: string): boolean => {
  const l = raw.trim();
  if (!l || l.length > 60) return false;
  if (EMAIL_RE.test(l) || PHONE_RE.test(l) || URL_RE.test(l) || l.includes('@')) return false;
  if (/\d/.test(l)) return false;
  const lower = l.toLowerCase().replace(/[:•|]/g, '').trim();
  if (SECTION_WORDS.has(lower)) return false;
  if (/^[A-Z]{2,}$/.test(l) && SECTION_WORDS.has(lower)) return false;
  const tokens = l.split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 5) return false;
  const looksTitleCased = tokens.every(t => /^[A-Z(]/.test(t) || /^[A-Z]\./.test(t) || t.length <= 3);
  return looksTitleCased;
};

const nameFromEmail = (email: string): string => {
  const local = email.split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
};

/* ── section detection ───────────────────────────────────── */

interface SectionHeader { key: string; re: RegExp; }

const SECTION_HEADERS: SectionHeader[] = [
  { key: 'summary',        re: /^\s*(summary|objective|profile|about(?:\s+me)?)\s*:?\s*$/i },
  { key: 'skills',         re: /^\s*(technical\s+skills|skills|technologies|tech\s+stack|core\s+competencies)\s*:?\s*$/i },
  { key: 'experience',     re: /^\s*(work\s+experience|professional\s+experience|experience|employment(?:\s+history)?)\s*:?\s*$/i },
  { key: 'projects',       re: /^\s*(projects|personal\s+projects|selected\s+projects|side\s+projects)\s*:?\s*$/i },
  { key: 'education',      re: /^\s*(education|academics?)\s*:?\s*$/i },
  { key: 'achievements',   re: /^\s*(achievements|awards|honors)\s*:?\s*$/i },
  { key: 'certifications', re: /^\s*(certifications?|licenses?)\s*:?\s*$/i },
];

const detectSection = (line: string): string | null => {
  for (const h of SECTION_HEADERS) {
    if (h.re.test(line)) return h.key;
  }
  return null;
};

const groupBySection = (ls: string[]): Map<string, string[]> => {
  const groups = new Map<string, string[]>();
  let current = 'other';
  for (const raw of ls) {
    const hit = detectSection(raw.trim());
    if (hit) {
      current = hit;
      if (!groups.has(current)) groups.set(current, []);
      continue;
    }
    if (!groups.has(current)) groups.set(current, []);
    groups.get(current)!.push(raw);
  }
  return groups;
};

/* ── bullet parsing ──────────────────────────────────────── */

const isBullet    = (l: string): boolean => /^\s*([-•*‣◦·]|\d+\.)\s+/.test(l);
const stripBullet = (l: string): string  => l.replace(/^\s*([-•*‣◦·]|\d+\.)\s+/, '').trim();

/* ── skills section parser ───────────────────────────────── */

const parseSkills = (sectionLines: string[]): string[] => {
  const flat: string[] = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw).trim();
    if (!line) continue;
    const afterColon = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    for (const part of afterColon.split(/[,•|/]|\s{2,}/)) {
      const s = part.trim().replace(/\.$/, '');
      if (s && s.length <= 32 && s.split(/\s+/).length <= 4 && !/[.!?]$/.test(s)) {
        flat.push(s);
      }
    }
  }
  return flat;
};

/* ── date helpers ────────────────────────────────────────── */

const DATE_RANGE_RE = /\(?\s*((?:19|20)\d{2}(?:-\d{2})?|\b[A-Za-z]{3,9}\.?\s+\d{4})\s*[-–—to]+\s*((?:19|20)\d{2}(?:-\d{2})?|present|current|now|[A-Za-z]{3,9}\.?\s+\d{4})\s*\)?/i;

const normalizeDate = (d: string): string => {
  const s = (d || '').trim();
  const ym = s.match(/^((?:19|20)\d{2})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const y = s.match(/((?:19|20)\d{2})/);
  if (!y) return '';
  const monMatch = s.match(/([A-Za-z]{3,9})/);
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const mm = monMatch ? months[monMatch[1].slice(0, 3).toLowerCase()] : undefined;
  return mm ? `${y[1]}-${mm}` : y[1];
};

/* ── experience parser ───────────────────────────────────── */

const parseExperience = (sectionLines: string[]): ExperienceEntry[] => {
  const entries: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;

  const push = () => {
    if (cur && (cur.role || cur.company)) entries.push(cur);
  };

  for (const raw of sectionLines) {
    const line = raw.trim();
    if (!line) continue;

    if (isBullet(line)) {
      if (cur) cur.bullets.push(stripBullet(line));
      continue;
    }

    push();
    let role = '';
    let company = '';
    let start = '';
    let end: string | null = null;

    const dm = line.match(DATE_RANGE_RE);
    let head = line;
    if (dm) {
      head = line.replace(dm[0], '').trim().replace(/[|,]\s*$/, '');
      start = normalizeDate(dm[1]);
      end = /present|current|now/i.test(dm[2]) ? null : normalizeDate(dm[2]);
    }

    const atSplit = head.split(/\s+(?:at|@|[-–—|,])\s+/);
    if (atSplit.length >= 2) {
      role = atSplit[0].trim();
      company = atSplit.slice(1).join(' ').trim();
    } else {
      role = head.trim();
    }

    cur = { company, role, start_date: start, end_date: end, bullets: [] };
  }
  push();
  return entries;
};

/* ── projects parser ─────────────────────────────────────── */

const parseProjects = (sectionLines: string[]): ProjectEntry[] => {
  const entries: ProjectEntry[] = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw).trim();
    if (!line) continue;

    let name = '';
    let description = '';
    const sep = line.match(/^([^:—–-]{2,60}?)\s*[:—–-]\s+(.*)$/);
    if (sep) {
      name = sep[1].trim();
      description = sep[2].trim();
    } else {
      name = line.slice(0, 60).trim();
    }

    const url = (line.match(URL_RE) || [''])[0];
    const technologies: string[] = [];
    const techTail = description.match(/[.,]?\s*([A-Z][\w.+#]*(?:\s*,\s*[A-Z][\w.+#]*)+)\s*$/);
    if (techTail) {
      for (const t of techTail[1].split(/\s*,\s*/)) {
        const tv = t.trim();
        if (tv) technologies.push(tv);
      }
    }

    if (name) entries.push({ name, description, technologies, url });
  }
  return entries;
};

/* ── education parser ────────────────────────────────────── */

const parseEducation = (sectionLines: string[]): EducationEntry[] => {
  const entries: EducationEntry[] = [];
  for (const raw of sectionLines) {
    const line = stripBullet(raw).trim();
    if (!line || (isBullet(raw) && line.length < 3)) continue;

    let start = '';
    let end: string | null = null;
    const dm = line.match(DATE_RANGE_RE);
    let head = line;
    if (dm) {
      head = line.replace(dm[0], '').trim().replace(/[|,]\s*$/, '');
      start = normalizeDate(dm[1]);
      end = /present|current|now/i.test(dm[2]) ? null : normalizeDate(dm[2]);
    }

    let degree = '';
    let field = '';
    let institution = '';
    const inMatch = head.match(/^(.*?)\bin\b\s+(.*?)(?:,\s*(.*))?$/i);
    if (inMatch) {
      degree = inMatch[1].trim();
      field = (inMatch[2] || '').replace(/,.*$/, '').trim();
      institution = (inMatch[3] || head.split(',').slice(1).join(',')).trim();
    } else {
      const parts = head.split(',');
      degree = (parts[0] || '').trim();
      institution = parts.slice(1).join(',').trim();
    }

    if (degree || institution) {
      entries.push({ institution, degree, field, start_date: start, end_date: end });
    }
  }
  return entries;
};

/* ── public: heuristic resume extraction ─────────────────── */

export function heuristicResumeExtract(rawText: string): any {
  const allLines = lines(rawText);
  const ne = nonEmpty(allLines);
  const joined = rawText || '';

  const email    = (joined.match(EMAIL_RE)    || [''])[0];
  const phone    = (joined.match(PHONE_RE)    || [''])[0].trim();
  const github   = (joined.match(GITHUB_RE)   || [''])[0];
  const linkedin = (joined.match(LINKEDIN_RE) || [''])[0];

  let name = '';
  for (const l of ne.slice(0, 5)) {
    if (looksLikeName(l)) {
      name = l.trim();
      break;
    }
  }
  if (!name && email) name = nameFromEmail(email);

  const identity: IdentityInfo = {
    name: name || '',
    email: email || '',
    phone: phone || '',
    location: '',
    linkedin: linkedin || '',
    github: github || '',
    website: '',
    summary: '',
  };

  const groups = groupBySection(allLines);

  if (groups.has('summary')) {
    identity.summary = nonEmpty(groups.get('summary')!).join(' ').slice(0, 600);
  }

  const flatSkills = groups.has('skills') ? parseSkills(groups.get('skills')!) : [];
  const skills = categorizeFlatSkills(flatSkills);
  const experience   = groups.has('experience')     ? parseExperience(groups.get('experience')!)     : [];
  const projects     = groups.has('projects')        ? parseProjects(groups.get('projects')!)         : [];
  const education    = groups.has('education')       ? parseEducation(groups.get('education')!)       : [];

  const resume = {
    identity,
    skills,
    skills_flat: flattenSkills(skills),
    experience,
    projects,
    education,
    achievements: [],
    certifications: [],
    leadership: [],
    _extraction_mode: 'heuristic' as const,
    _schema_version: PROFILE_SCHEMA_VERSION,
  };

  return resume;
}

/* ── JD-level / employment heuristics ────────────────────── */

const LEVEL_FROM_TEXT = (t: string): JDLevel => {
  const s = t.toLowerCase();
  if (/\bprincipal\b/.test(s))                         return 'principal';
  if (/\bstaff\b/.test(s))                             return 'staff';
  if (/\bsenior\b|\bsr\.?\b|\blead\b/.test(s))        return 'senior';
  if (/\bintern(ship)?\b/.test(s))                     return 'intern';
  if (/\bentry|junior|\bjr\.?\b|graduate\b/.test(s))   return 'entry';
  return 'mid';
};

const EMPLOYMENT_FROM_TEXT = (t: string): EmploymentType => {
  const s = t.toLowerCase();
  if (/\bintern(ship)?\b/.test(s))                     return 'internship';
  if (/\bcontract(or)?\b|\bfreelance\b/.test(s))      return 'contract';
  if (/\bpart[-\s]?time\b/.test(s))                    return 'part_time';
  return 'full_time';
};

/* ── JD section detection ────────────────────────────────── */

const JD_HEADER_RE = /^\s*(about(?:\s+the\s+role)?|requirements|qualifications|nice to haves?|bonus|preferred|responsibilities|what you'?ll do|the role|benefits|perks|how to apply|compensation)\s*:?\s*$/i;
const detectJDHeader = (line: string): boolean => JD_HEADER_RE.test(line);

/* ── public: heuristic JD extraction ─────────────────────── */

export function heuristicJDExtract(rawText: string): any {
  const allLines = lines(rawText);
  const ne = nonEmpty(allLines);

  const title = ne[0] ? ne[0].slice(0, 80) : 'Unknown Role';

  const collectSection = (re: RegExp): string[] => {
    const out: string[] = [];
    let capturing = false;
    for (const raw of allLines) {
      const line = raw.trim();
      if (re.test(line)) {
        capturing = true;
        continue;
      }
      if (capturing) {
        if (detectJDHeader(line)) break;
        if (line) out.push(stripBullet(line));
      }
    }
    return out;
  };

  const requirements    = collectSection(/^\s*(requirements|qualifications|what you'?ll need|must haves?|you have)\s*:?\s*$/i);
  const nice            = collectSection(/^\s*(nice to haves?|bonus|preferred|pluses?)\s*:?\s*$/i);
  const responsibilities = collectSection(/^\s*(responsibilities|what you'?ll do|the role|day to day)\s*:?\s*$/i);

  let company = '';
  const companyLine = ne.slice(1, 4).find(l => /—|\bat\b|·|\|/.test(l));
  if (companyLine) company = companyLine.split(/—|\bat\b|·|\|/)[0].trim();

  const jd = {
    title,
    company: company || '',
    location: '',
    description_summary: ne.slice(0, 3).join(' ').slice(0, 400),
    level: LEVEL_FROM_TEXT(`${title} ${rawText.slice(0, 400)}`),
    employment_type: EMPLOYMENT_FROM_TEXT(rawText.slice(0, 800)),
    min_years_experience: (() => {
      const m = rawText.match(/(\d+)\+?\s*years?/i);
      return m ? Number(m[1]) : 0;
    })(),
    compensation_hint: (rawText.match(/\$\s?\d[\d,]*\s?[kK]?(?:\s*[-–]\s*\$?\s?\d[\d,]*\s?[kK]?)?/) || [''])[0],
    requirements,
    nice_to_haves: nice,
    responsibilities,
    technologies: [] as string[],
    keywords: [] as string[],
    _extraction_mode: 'heuristic' as const,
    _schema_version: PROFILE_SCHEMA_VERSION,
  };

  return jd;
}
