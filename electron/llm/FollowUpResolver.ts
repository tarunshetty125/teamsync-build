// electron/llm/FollowUpResolver.ts
// Resolves bare follow-up fragments ("why?", "and Python?", "how so?")
// against the prior conversation turn to determine the concrete answer type.

/* ── Types ────────────────────────────────────────────────── */

export interface FollowUpContext {
  latestQuestion: string;
  previousQuestion?: string;
  previousAnswerType?: string;
  lastEntity?: string;
  extractedQuestion?: { followUpTarget?: string };
}

export interface FollowUpResolution {
  resolvedQuestion: string;
  resolvedAnswerType?: string;
  resolvedEntity?: string;
  resolvedSkill?: string;
  confidence: number;
  reason: string;
}

/* ── Constants ────────────────────────────────────────────── */

const NONE: FollowUpResolution = { resolvedQuestion: '', confidence: 0, reason: 'not_a_followup' };

const EXPAND_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|hmm,?\s*|right,?\s*)*(?:why|how so|how come|can you (?:expand|elaborate|go deeper)|expand|elaborate|tell me more|go on|continue|in more detail)\b[\s?.!]*$/i;
const TOPIC_SHIFT_RE = /\b(?:and|what about|how about|what's your|and your)\s+([a-z0-9+#.\- ]{2,30}?)\s*\??$/i;
const SKILL_TOKEN_RE = /\b(python|sql|java(?:script)?|typescript|react|node(?:\.?js)?|c\+\+|go(?:lang)?|rust|aws|gcp|azure|docker|kubernetes|graphql|rest|fastapi|django|flask|spring|pandas|numpy|spark|hadoop|tableau|power\s?bi|excel|tensorflow|pytorch|coding|backend|frontend|full[\s-]?stack|data|analytics|databases?|dashboards?|machine learning|ml|statistics?)\b/i;
const PROJECT_DRILLIN_RE = /^(?:ok(?:ay)?,?\s*|so,?\s*|and,?\s*)*(?:how (?:is|was|are|were) (?:it|that|this)|how (?:is|was) (?:it|that) (?:developed|built|made|designed|implemented)|that project|the project|what (?:stack|backend|database|tech)|your role|why did you build|how did you (?:build|make|optimi[sz]e))\b/i;

/* ── Prior-turn detectors ─────────────────────────────────── */

const lc = (s: string | undefined): string => (s || '').trim().toLowerCase();

function prevWasSkill(ctx: FollowUpContext): boolean {
  const t = lc(ctx.previousQuestion);
  return ctx.previousAnswerType === 'skill_experience_answer' ||
    ctx.previousAnswerType === 'skills_answer' ||
    /\b(rate|out of (?:10|ten)|how (?:good|comfortable|proficient)|have you used|experience with|how have you used)\b/.test(t);
}

function prevWasCoding(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'coding_question_answer' ||
    ctx.previousAnswerType === 'dsa_question_answer' ||
    /\b(solve|implement|write (?:code|a|the)|two sum|binary search|reverse|palindrome|leetcode)\b/.test(lc(ctx.previousQuestion));
}

function prevWasProject(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'project_answer' ||
    ctx.previousAnswerType === 'project_followup_answer' ||
    !!ctx.lastEntity ||
    /\bproject|built|developed|natively\b/.test(lc(ctx.previousQuestion));
}

function prevWasJdFit(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'jd_fit_answer' ||
    /\bfit|hire|role|why (?:this|you)|data analyst\b/.test(lc(ctx.previousQuestion));
}

function prevWasTechnicalConcept(ctx: FollowUpContext): boolean {
  return ctx.previousAnswerType === 'technical_concept_answer' ||
    ctx.previousAnswerType === 'system_design_answer' ||
    ctx.previousAnswerType === 'debugging_question_answer' ||
    /\b(explain|what is|how does|difference between|bfs|dfs|deadlock|complexity|rest|graphql|index)\b/.test(lc(ctx.previousQuestion));
}

/* ── Main resolver ────────────────────────────────────────── */

export function resolveFollowUp(ctx: FollowUpContext): FollowUpResolution {
  const q = lc(ctx.latestQuestion);
  if (!q) return NONE;

  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return NONE;

  // Topic shift: "and Python?", "what about SQL?"
  const shift = q.match(TOPIC_SHIFT_RE);
  if (shift) {
    const skillRaw = shift[1].trim();
    const skillMatch = skillRaw.match(SKILL_TOKEN_RE);

    if (skillMatch && prevWasSkill(ctx)) {
      const skill = skillMatch[0];
      const wasRating = /\brate|out of (?:10|ten)|scale\b/.test(lc(ctx.previousQuestion));
      return {
        resolvedQuestion: wasRating ? `Rate your ${skill} skills out of 10.` : `What is your experience with ${skill}?`,
        resolvedAnswerType: 'skill_experience_answer',
        resolvedSkill: skill,
        confidence: 0.9,
        reason: 'topic_shift_skill',
      };
    }
    if (/\b(data|analytics|stakeholders?|metrics?)\b/.test(skillRaw) && prevWasJdFit(ctx)) {
      return {
        resolvedQuestion: `How does my ${skillRaw} experience fit this role?`,
        resolvedAnswerType: 'jd_fit_answer',
        confidence: 0.7,
        reason: 'topic_shift_jdfit',
      };
    }
    if (skillMatch) {
      return {
        resolvedQuestion: `What is your experience with ${skillMatch[0]}?`,
        resolvedAnswerType: 'skill_experience_answer',
        resolvedSkill: skillMatch[0],
        confidence: 0.6,
        reason: 'topic_shift_skill_weak',
      };
    }
  }

  // Project drill-in
  if (PROJECT_DRILLIN_RE.test(q) && (ctx.lastEntity || prevWasProject(ctx))) {
    return {
      resolvedQuestion: ctx.lastEntity
        ? `${ctx.latestQuestion.replace(/\b(it|that|this)\b/i, ctx.lastEntity).trim()}`.replace(/\?*$/, '?')
        : 'Can you go deeper on that project?',
      resolvedAnswerType: 'project_followup_answer',
      resolvedEntity: ctx.lastEntity,
      confidence: 0.85,
      reason: 'project_drillin',
    };
  }

  // Expand / elaborate
  if (EXPAND_RE.test(q)) {
    if (prevWasCoding(ctx)) {
      const aboutComplexity = /\bcomplexity\b/.test(q);
      return {
        resolvedQuestion: aboutComplexity
          ? 'What is the time and space complexity of the previous solution?'
          : 'Can you explain the previous solution in more detail?',
        resolvedAnswerType: 'technical_concept_answer',
        confidence: 0.8,
        reason: 'expand_coding',
      };
    }
    if (prevWasProject(ctx)) {
      return {
        resolvedQuestion: ctx.lastEntity ? `Can you expand on ${ctx.lastEntity}?` : 'Can you expand on that project?',
        resolvedAnswerType: 'project_followup_answer',
        resolvedEntity: ctx.lastEntity,
        confidence: 0.75,
        reason: 'expand_project',
      };
    }
    if (prevWasJdFit(ctx)) {
      return { resolvedQuestion: 'Can you expand on why you fit this role?', resolvedAnswerType: 'jd_fit_answer', confidence: 0.7, reason: 'expand_jdfit' };
    }
    if (prevWasTechnicalConcept(ctx)) {
      return {
        resolvedQuestion: ctx.previousQuestion ? `Can you explain that in more detail: ${ctx.previousQuestion}` : 'Can you explain that in more detail?',
        resolvedAnswerType: 'technical_concept_answer',
        confidence: 0.7,
        reason: 'expand_technical',
      };
    }
    if (ctx.previousAnswerType) {
      return {
        resolvedQuestion: ctx.previousQuestion ? `Can you expand on: ${ctx.previousQuestion}` : 'Can you expand on that?',
        resolvedAnswerType: ctx.previousAnswerType,
        confidence: 0.6,
        reason: 'expand_inherit',
      };
    }
  }

  // Bare "complexity" after coding
  if (/\bcomplexity\b/.test(q) && prevWasCoding(ctx)) {
    return {
      resolvedQuestion: 'What is the time and space complexity of the previous solution?',
      resolvedAnswerType: 'technical_concept_answer',
      confidence: 0.8,
      reason: 'complexity_followup',
    };
  }

  return NONE;
}
