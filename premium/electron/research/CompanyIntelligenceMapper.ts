import { JDContext } from '../knowledge/CompanyResearchEngine';
import { callWithRetry, safeParseJSONObject } from '../knowledge/llmUtils';
import { CompanyDossier, CriticInsight, EmployeeReview, SalaryEstimate } from '../knowledge/types';

export type CompanySalaryBand = {
  title: string;
  location: string;
  range: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
};

export type CompanySalaryInsight = {
  summary: string;
  estimates: CompanySalaryBand[];
};

export type CompanyWorkCultureInsight = {
  summary: string;
  overallRating: number | null;
  reviewCount: string;
  dataSources: string[];
};

export type CompanyInsights = {
  company: string;
  role: string;
  companyOverview: string;
  hiringStrategy: string;
  interviewFocus: string;
  salary: CompanySalaryInsight;
  workCulture: CompanyWorkCultureInsight;
  reviews: string[];
  complaints: string[];
  benefits: string[];
  values: string[];
  techStack: string[];
  roleExpectations: string[];
  interviewTips: string[];
  cultureNotes: string[];
  updatedAt: string;
  sourceCount: number;
  generationId?: number;
};

type MapperInput = {
  companyName: string;
  role: string;
  dossier: CompanyDossier | null;
  jdCtx?: JDContext;
};

const KNOWN_TECH_KEYWORDS = [
  'React',
  'React.js',
  'Angular',
  'Vue',
  'Next.js',
  'Node.js',
  'Express',
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'Go',
  'Rust',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'GraphQL',
  'REST APIs',
  'MongoDB',
  'MySQL',
  'PostgreSQL',
  'Redis',
  'Tailwind CSS',
  'HTML',
  'CSS',
  'Electron',
  'SQLite',
  'OpenAI',
  'Groq',
  'Gemini',
] as const;

function uniqueStrings(values: Array<string | null | undefined>, limit = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) break;
  }

  return result;
}

function sentenceChunks(text: string, limit = 3): string[] {
  if (!text.trim()) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractTechStack(dossier: CompanyDossier | null, jdCtx: JDContext = {}): string[] {
  const haystack = [
    ...(jdCtx.technologies || []),
    ...(jdCtx.keywords || []),
    dossier?.recent_news || '',
    dossier?.hiring_strategy || '',
    dossier?.interview_focus || '',
    ...(dossier?.employee_reviews?.map((review) => review.quote) || []),
  ].join('\n');

  const matched = KNOWN_TECH_KEYWORDS.filter((keyword) => {
    const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(haystack);
  });

  return uniqueStrings([...(jdCtx.technologies || []), ...matched], 10);
}

function buildCompanyOverview(companyName: string, role: string, dossier: CompanyDossier | null): string {
  const overview = uniqueStrings([dossier?.hiring_strategy, dossier?.recent_news], 2);
  if (overview.length > 0) {
    return overview.join(' ');
  }
  return `${companyName} is being analyzed for the ${role || 'target'} role. External research will appear here once live search-backed intelligence completes.`;
}

function buildRoleExpectations(role: string, jdCtx: JDContext = {}, dossier: CompanyDossier | null): string[] {
  const seeded = uniqueStrings([...(jdCtx.responsibilities || []), ...(jdCtx.requirements || [])], 6);
  if (seeded.length > 0) return seeded;

  const interviewSentences = sentenceChunks(dossier?.interview_focus || '', 3);
  if (interviewSentences.length > 0) return interviewSentences;

  const strategySentences = sentenceChunks(dossier?.hiring_strategy || '', 3);
  if (strategySentences.length > 0) return strategySentences;

  return role ? [`Expect core responsibilities aligned with the ${role} role.`] : [];
}

function buildInterviewTips(dossier: CompanyDossier | null, jdCtx: JDContext = {}): string[] {
  return uniqueStrings(
    [
      ...sentenceChunks(dossier?.interview_focus || '', 3),
      dossier?.interview_difficulty
        ? `Expect an overall ${dossier.interview_difficulty.replace(/_/g, ' ')} interview loop and calibrate your examples accordingly.`
        : null,
      jdCtx.technologies?.length
        ? `Be ready to discuss hands-on depth in ${jdCtx.technologies.slice(0, 4).join(', ')}.`
        : null,
    ],
    5,
  );
}

function buildCultureNotes(dossier: CompanyDossier | null): string[] {
  return uniqueStrings(
    [
      ...(dossier?.core_values?.map((value) => `Core value signal: ${value}`) || []),
      ...(dossier?.benefits?.slice(0, 2).map((benefit) => `Benefits note: ${benefit}`) || []),
      ...(dossier?.critics?.slice(0, 2).map((critic) => `${critic.category}: ${critic.complaint}`) || []),
      dossier?.culture_ratings?.overall
        ? `Culture rating trends around ${dossier.culture_ratings.overall.toFixed(1)}/5 overall.`
        : null,
    ],
    5,
  );
}

function formatSalaryRange(estimate: SalaryEstimate): string {
  const min = typeof estimate.min === 'number' ? estimate.min.toLocaleString() : '0';
  const max = typeof estimate.max === 'number' ? estimate.max.toLocaleString() : '0';
  return `${estimate.currency || 'USD'} ${min} - ${max}`;
}

function buildSalaryInsight(dossier: CompanyDossier | null): CompanySalaryInsight {
  const estimates = Array.isArray(dossier?.salary_estimates)
    ? dossier.salary_estimates
        .filter((estimate) => estimate && (estimate.min || estimate.max))
        .slice(0, 4)
        .map((estimate) => ({
          title: estimate.title || 'Role',
          location: estimate.location || 'Market',
          range: formatSalaryRange(estimate),
          confidence: estimate.confidence || 'low',
          source: estimate.source || 'Market signal',
        }))
    : [];

  const summary = estimates.length > 0
    ? `Compensation signals were found across ${estimates.length} market references. Use them to frame expectations and anchor your target range.`
    : 'Compensation signals will appear once live research sources surface salary references for this company and role.';

  return { summary, estimates };
}

function buildWorkCulture(dossier: CompanyDossier | null): CompanyWorkCultureInsight {
  const rating = dossier?.culture_ratings?.overall;
  const reviewCount = dossier?.culture_ratings?.review_count || '';
  const dataSources = Array.isArray(dossier?.culture_ratings?.data_sources) ? dossier!.culture_ratings!.data_sources : [];

  const summary = rating && rating > 0
    ? `${dossier?.company || 'The company'} trends around ${rating.toFixed(1)}/5 overall, with review signals coming from ${dataSources.length > 0 ? dataSources.join(', ') : 'multiple employee feedback channels'}.`
    : 'Culture signals are still limited. Use the notes below to understand team dynamics, growth expectations, and trade-offs.';

  return {
    summary,
    overallRating: typeof rating === 'number' ? rating : null,
    reviewCount,
    dataSources,
  };
}

function buildReviews(reviews: EmployeeReview[] | undefined): string[] {
  return uniqueStrings(
    (reviews || []).map((review) => {
      const source = review.source ? ` (${review.source})` : '';
      return review.quote ? `${review.quote}${source}` : null;
    }),
    5,
  );
}

function buildComplaints(critics: CriticInsight[] | undefined): string[] {
  return uniqueStrings(
    (critics || []).map((critic) => {
      const category = critic.category ? `${critic.category}: ` : '';
      return critic.complaint ? `${category}${critic.complaint}` : null;
    }),
    5,
  );
}

function coerceStringArray(values: unknown, limit = 6): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(
    values.map((value) => (typeof value === 'string' ? value : null)),
    limit,
  );
}

function mergeSalary(fallback: CompanySalaryInsight, incoming: any): CompanySalaryInsight {
  const incomingEstimates = Array.isArray(incoming?.estimates)
    ? incoming.estimates
        .map((estimate: any) => ({
          title: typeof estimate?.title === 'string' ? estimate.title.trim() : '',
          location: typeof estimate?.location === 'string' ? estimate.location.trim() : '',
          range: typeof estimate?.range === 'string' ? estimate.range.trim() : '',
          confidence: estimate?.confidence === 'high' || estimate?.confidence === 'medium' || estimate?.confidence === 'low'
            ? estimate.confidence
            : 'low',
          source: typeof estimate?.source === 'string' ? estimate.source.trim() : '',
        }))
        .filter((estimate: CompanySalaryBand) => estimate.title || estimate.range)
        .slice(0, 4)
    : [];

  return {
    summary: typeof incoming?.summary === 'string' && incoming.summary.trim()
      ? incoming.summary.trim()
      : fallback.summary,
    estimates: incomingEstimates.length > 0 ? incomingEstimates : fallback.estimates,
  };
}

function mergeWorkCulture(fallback: CompanyWorkCultureInsight, incoming: any): CompanyWorkCultureInsight {
  return {
    summary: typeof incoming?.summary === 'string' && incoming.summary.trim()
      ? incoming.summary.trim()
      : fallback.summary,
    overallRating: typeof incoming?.overallRating === 'number'
      ? incoming.overallRating
      : fallback.overallRating,
    reviewCount: typeof incoming?.reviewCount === 'string' && incoming.reviewCount.trim()
      ? incoming.reviewCount.trim()
      : fallback.reviewCount,
    dataSources: coerceStringArray(incoming?.dataSources, 5).length > 0
      ? coerceStringArray(incoming?.dataSources, 5)
      : fallback.dataSources,
  };
}

function buildFallbackInsights({ companyName, role, dossier, jdCtx = {} }: MapperInput): CompanyInsights {
  const techStack = extractTechStack(dossier, jdCtx);
  const roleExpectations = buildRoleExpectations(role, jdCtx, dossier);
  const interviewTips = buildInterviewTips(dossier, jdCtx);
  const cultureNotes = buildCultureNotes(dossier);

  return {
    company: companyName,
    role,
    companyOverview: buildCompanyOverview(companyName, role, dossier),
    hiringStrategy: dossier?.hiring_strategy || `Position ${role || 'the role'} against the company's near-term hiring priorities and make your impact easy to verify.`,
    interviewFocus: dossier?.interview_focus || `Expect the team to test how your experience maps to the ${role || 'target'} role and how quickly you can add value.`,
    salary: buildSalaryInsight(dossier),
    workCulture: buildWorkCulture(dossier),
    reviews: buildReviews(dossier?.employee_reviews),
    complaints: buildComplaints(dossier?.critics),
    benefits: coerceStringArray(dossier?.benefits, 8),
    values: coerceStringArray(dossier?.core_values, 8),
    techStack,
    roleExpectations,
    interviewTips,
    cultureNotes,
    updatedAt: dossier?.fetched_at || new Date().toISOString(),
    sourceCount: dossier?.sources?.filter(Boolean).length || 0,
  };
}

export class CompanyIntelligenceMapper {
  private generateContentFn: ((contents: any[]) => Promise<string>) | null = null;

  setGenerateContentFn(fn: ((contents: any[]) => Promise<string>) | null): void {
    this.generateContentFn = fn;
  }

  mapDeterministic(input: MapperInput): CompanyInsights {
    return buildFallbackInsights(input);
  }

  async map(input: MapperInput): Promise<CompanyInsights> {
    const fallback = this.mapDeterministic(input);

    if (!this.generateContentFn || !input.dossier) {
      return fallback;
    }

    const prompt = `You are a company intelligence analyst for interview preparation.
Return ONLY valid JSON. No markdown. No explanation. No extra text.

Transform the dossier into concise, human-readable interview prep insights.
Schema:
{
  "companyOverview": "string",
  "hiringStrategy": "string",
  "interviewFocus": "string",
  "salary": {
    "summary": "string",
    "estimates": [
      { "title": "string", "location": "string", "range": "string", "confidence": "low|medium|high", "source": "string" }
    ]
  },
  "workCulture": {
    "summary": "string",
    "overallRating": 0,
    "reviewCount": "string",
    "dataSources": ["string"]
  },
  "reviews": ["string"],
  "complaints": ["string"],
  "benefits": ["string"],
  "values": ["string"],
  "techStack": ["string"],
  "roleExpectations": ["string"],
  "interviewTips": ["string"],
  "cultureNotes": ["string"]
}

Company: ${input.companyName}
Role: ${input.role || 'General'}
JD context: ${JSON.stringify(input.jdCtx || {})}
Dossier JSON:
${JSON.stringify(input.dossier)}`;

    try {
      const raw = await callWithRetry(
        () => this.generateContentFn!([{ text: prompt }]),
        30000,
      );
      const parsed = safeParseJSONObject<Partial<CompanyInsights>>(raw);

      if (!parsed.value || parsed.error) {
        return fallback;
      }

      return {
        company: input.companyName,
        role: input.role,
        companyOverview: typeof parsed.value.companyOverview === 'string' && parsed.value.companyOverview.trim()
          ? parsed.value.companyOverview.trim()
          : fallback.companyOverview,
        hiringStrategy: typeof parsed.value.hiringStrategy === 'string' && parsed.value.hiringStrategy.trim()
          ? parsed.value.hiringStrategy.trim()
          : fallback.hiringStrategy,
        interviewFocus: typeof parsed.value.interviewFocus === 'string' && parsed.value.interviewFocus.trim()
          ? parsed.value.interviewFocus.trim()
          : fallback.interviewFocus,
        salary: mergeSalary(fallback.salary, parsed.value.salary),
        workCulture: mergeWorkCulture(fallback.workCulture, parsed.value.workCulture),
        reviews: coerceStringArray(parsed.value.reviews, 5).length > 0
          ? coerceStringArray(parsed.value.reviews, 5)
          : fallback.reviews,
        complaints: coerceStringArray(parsed.value.complaints, 5).length > 0
          ? coerceStringArray(parsed.value.complaints, 5)
          : fallback.complaints,
        benefits: coerceStringArray(parsed.value.benefits, 8).length > 0
          ? coerceStringArray(parsed.value.benefits, 8)
          : fallback.benefits,
        values: coerceStringArray(parsed.value.values, 8).length > 0
          ? coerceStringArray(parsed.value.values, 8)
          : fallback.values,
        techStack: coerceStringArray(parsed.value.techStack, 10).length > 0
          ? coerceStringArray(parsed.value.techStack, 10)
          : fallback.techStack,
        roleExpectations: coerceStringArray(parsed.value.roleExpectations, 6).length > 0
          ? coerceStringArray(parsed.value.roleExpectations, 6)
          : fallback.roleExpectations,
        interviewTips: coerceStringArray(parsed.value.interviewTips, 6).length > 0
          ? coerceStringArray(parsed.value.interviewTips, 6)
          : fallback.interviewTips,
        cultureNotes: coerceStringArray(parsed.value.cultureNotes, 6).length > 0
          ? coerceStringArray(parsed.value.cultureNotes, 6)
          : fallback.cultureNotes,
        updatedAt: fallback.updatedAt,
        sourceCount: fallback.sourceCount,
      };
    } catch {
      return fallback;
    }
  }
}
