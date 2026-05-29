import type { ModeTemplateId } from './types';

export type SessionOverlayMode = 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design';
export type OverlayCopilotModeId = ModeTemplateId | SessionOverlayMode;
export type OverlayActionIntent =
  | 'what_to_answer'
  | 'recap'
  | 'clarify'
  | 'brainstorm'
  | 'follow_up_questions';
export type OverlayRecommendationId = OverlayQuickActionId | 'answer_now';
export type OverlayQuickActionId =
  | 'what_to_answer'
  | 'recap'
  | 'clarify'
  | 'brainstorm'
  | 'follow_up_questions'
  | 'tech_hint'
  | 'tech_optimal_solution'
  | 'tech_complexity'
  | 'tech_edge_case'
  | 'sales_objection'
  | 'sales_pricing'
  | 'sales_discovery'
  | 'sales_negotiation'
  | 'lecture_explain'
  | 'lecture_summary'
  | 'lecture_takeaway'
  | 'lecture_question'
  | 'recruiting_strength'
  | 'recruiting_red_flag'
  | 'recruiting_follow_up'
  | 'recruiting_evaluation'
  | 'team_decision'
  | 'team_action_item'
  | 'team_risk'
  | 'team_owner'
  | 'job_star'
  | 'job_resume_alignment'
  | 'job_confidence'
  | 'job_improvement'
  | 'system_tradeoffs'
  | 'system_clarify'
  | 'system_approaches'
  | 'system_deep_dive'
  | 'salary_negotiate'
  | 'salary_counter'
  | 'salary_confidence'
  | 'salary_anchor';

export interface OverlayQuickActionDef {
  id: OverlayQuickActionId;
  label: string;
  icon: string;
  intent: OverlayActionIntent;
  source: string;
  analyticsKey: string;
  additionalContext?: string;
  message?: string;
  profilePreference?: 'default' | 'force_on' | 'force_off';
}

type RecommendationRule = {
  actionId: OverlayRecommendationId;
  patterns: RegExp[];
};

type OverlayModeConfig = {
  actionIds: OverlayQuickActionId[] | ((brainstormEnabled: boolean) => OverlayQuickActionId[]);
  recommendedRules: RecommendationRule[];
  defaultRecommendedActionId: OverlayRecommendationId;
};

const ACTIONS: Record<OverlayQuickActionId, OverlayQuickActionDef> = {
  what_to_answer: {
    id: 'what_to_answer',
    label: 'Suggest',
    icon: '💡',
    intent: 'what_to_answer',
    source: 'What to Answer',
    analyticsKey: 'what_to_say',
  },
  recap: {
    id: 'recap',
    label: 'Recap',
    icon: '📝',
    intent: 'recap',
    source: 'Recap',
    analyticsKey: 'recap',
  },
  clarify: {
    id: 'clarify',
    label: 'Clarify',
    icon: '❓',
    intent: 'clarify',
    source: 'Clarify',
    analyticsKey: 'clarify',
  },
  brainstorm: {
    id: 'brainstorm',
    label: 'Brainstorm',
    icon: '🧠',
    intent: 'brainstorm',
    source: 'Brainstorm',
    analyticsKey: 'brainstorm',
  },
  follow_up_questions: {
    id: 'follow_up_questions',
    label: 'Follow Up',
    icon: '➡️',
    intent: 'follow_up_questions',
    source: 'Follow Up Questions',
    analyticsKey: 'suggest_questions',
  },
  tech_hint: {
    id: 'tech_hint',
    label: 'Hint',
    icon: '🧩',
    intent: 'what_to_answer',
    source: 'Technical Hint',
    analyticsKey: 'tech_hint',
    additionalContext: 'Technical interview mode: give only a concise hint, not the full solution. Focus on DSA or implementation direction, key invariant, or next debugging step.',
    profilePreference: 'force_off',
  },
  tech_optimal_solution: {
    id: 'tech_optimal_solution',
    label: 'Optimal',
    icon: '⚙️',
    intent: 'what_to_answer',
    source: 'Optimal Solution',
    analyticsKey: 'tech_optimal_solution',
    additionalContext: 'Technical interview mode: optimize for the strongest solution. Emphasize algorithm choice, tradeoffs, and why this is the best approach.',
    profilePreference: 'force_off',
  },
  tech_complexity: {
    id: 'tech_complexity',
    label: 'Complexity',
    icon: '⏱️',
    intent: 'clarify',
    source: 'Complexity Analysis',
    analyticsKey: 'tech_complexity',
    additionalContext: 'Technical interview mode: explain the time and space complexity clearly, including the dominant factors and any important tradeoffs.',
    profilePreference: 'force_off',
  },
  tech_edge_case: {
    id: 'tech_edge_case',
    label: 'Edge Case',
    icon: '🛡️',
    intent: 'brainstorm',
    source: 'Edge Cases',
    analyticsKey: 'tech_edge_case',
    additionalContext: 'Technical interview mode: list the most important edge cases, failure modes, and test cases to mention next. Keep it concise and practical.',
    profilePreference: 'force_off',
  },
  sales_objection: {
    id: 'sales_objection',
    label: 'Handle Objection',
    icon: '🛟',
    intent: 'what_to_answer',
    source: 'Handle Objection',
    analyticsKey: 'sales_objection',
    additionalContext: 'Sales mode: address the objection directly, validate the concern, de-risk the answer, and move toward commitment. Focus on objections, buyer hesitation, and next-step language.',
  },
  sales_pricing: {
    id: 'sales_pricing',
    label: 'Pricing Response',
    icon: '💰',
    intent: 'what_to_answer',
    source: 'Pricing Response',
    analyticsKey: 'sales_pricing',
    additionalContext: 'Sales mode: answer pricing questions with value framing, ROI, packaging clarity, and confident but concise negotiation-safe language.',
  },
  sales_discovery: {
    id: 'sales_discovery',
    label: 'Discovery Question',
    icon: '🧭',
    intent: 'follow_up_questions',
    source: 'Discovery Questions',
    analyticsKey: 'sales_discovery',
    additionalContext: 'Sales mode: generate the best discovery question or next few discovery prompts to uncover pain points, urgency, decision process, budget, and success criteria.',
  },
  sales_negotiation: {
    id: 'sales_negotiation',
    label: 'Negotiation Angle',
    icon: '🤝',
    intent: 'brainstorm',
    source: 'Negotiation Angle',
    analyticsKey: 'sales_negotiation',
    additionalContext: 'Sales mode: identify the strongest negotiation angle, concessions to avoid, leverage points, and how to protect price while keeping momentum.',
  },
  lecture_explain: {
    id: 'lecture_explain',
    label: 'Explain Concept',
    icon: '📘',
    intent: 'clarify',
    source: 'Explain Concept',
    analyticsKey: 'lecture_explain',
    additionalContext: 'Lecture mode: explain the current concept simply, reduce jargon, and make the explanation easy to learn from quickly.',
    profilePreference: 'force_off',
  },
  lecture_summary: {
    id: 'lecture_summary',
    label: 'Summarize Section',
    icon: '📝',
    intent: 'recap',
    source: 'Summarize Section',
    analyticsKey: 'lecture_summary',
    additionalContext: 'Lecture mode: summarize the latest section into compact learning notes, focusing on the important concepts and structure.',
    profilePreference: 'force_off',
  },
  lecture_takeaway: {
    id: 'lecture_takeaway',
    label: 'Key Takeaway',
    icon: '⭐',
    intent: 'what_to_answer',
    source: 'Key Takeaway',
    analyticsKey: 'lecture_takeaway',
    additionalContext: 'Lecture mode: extract the single most important takeaway from the current explanation and state why it matters.',
    profilePreference: 'force_off',
  },
  lecture_question: {
    id: 'lecture_question',
    label: 'Ask Clarification',
    icon: '🙋',
    intent: 'follow_up_questions',
    source: 'Ask Clarification',
    analyticsKey: 'lecture_question',
    additionalContext: 'Lecture mode: suggest a sharp clarifying question the learner should ask next to deepen understanding or resolve confusion.',
    profilePreference: 'force_off',
  },
  recruiting_strength: {
    id: 'recruiting_strength',
    label: 'Candidate Strength',
    icon: '✅',
    intent: 'what_to_answer',
    source: 'Candidate Strength',
    analyticsKey: 'recruiting_strength',
    additionalContext: 'Recruiting mode: extract the strongest candidate signals, strengths, and evidence from the latest discussion. Use hiring-rubric language.',
  },
  recruiting_red_flag: {
    id: 'recruiting_red_flag',
    label: 'Red Flag',
    icon: '🚩',
    intent: 'clarify',
    source: 'Candidate Red Flag',
    analyticsKey: 'recruiting_red_flag',
    additionalContext: 'Recruiting mode: identify concerns, missing evidence, risks, or weak signals that deserve scrutiny before advancing the candidate.',
  },
  recruiting_follow_up: {
    id: 'recruiting_follow_up',
    label: 'Follow-up Question',
    icon: '🔎',
    intent: 'follow_up_questions',
    source: 'Candidate Follow-up',
    analyticsKey: 'recruiting_follow_up',
    additionalContext: 'Recruiting mode: generate the best follow-up question to validate skill, fit, ownership, or weak areas.',
  },
  recruiting_evaluation: {
    id: 'recruiting_evaluation',
    label: 'Evaluation',
    icon: '📋',
    intent: 'brainstorm',
    source: 'Candidate Evaluation',
    analyticsKey: 'recruiting_evaluation',
    additionalContext: 'Recruiting mode: produce a concise fit analysis with strengths, concerns, likely level, and recommendation signal.',
  },
  team_decision: {
    id: 'team_decision',
    label: 'Decision',
    icon: '🧾',
    intent: 'what_to_answer',
    source: 'Decision Extraction',
    analyticsKey: 'team_decision',
    additionalContext: 'Team meeting mode: identify the decision that was made or should be made now. Emphasize rationale and unresolved dependencies.',
  },
  team_action_item: {
    id: 'team_action_item',
    label: 'Action Item',
    icon: '✅',
    intent: 'follow_up_questions',
    source: 'Action Items',
    analyticsKey: 'team_action_item',
    additionalContext: 'Team meeting mode: extract the next action items, with suggested owners and immediate follow-up questions if ownership is unclear.',
  },
  team_risk: {
    id: 'team_risk',
    label: 'Blocker',
    icon: '⚠️',
    intent: 'clarify',
    source: 'Blockers and Risks',
    analyticsKey: 'team_risk',
    additionalContext: 'Team meeting mode: identify blockers, risks, dependencies, and what could slip if the team does nothing next.',
  },
  team_owner: {
    id: 'team_owner',
    label: 'Owner',
    icon: '👤',
    intent: 'brainstorm',
    source: 'Owner Tracking',
    analyticsKey: 'team_owner',
    additionalContext: 'Team meeting mode: identify likely owners, missing ownership, and how to phrase ownership assignment clearly.',
  },
  job_star: {
    id: 'job_star',
    label: 'STAR Response',
    icon: '🌟',
    intent: 'what_to_answer',
    source: 'STAR Response',
    analyticsKey: 'job_star',
    additionalContext: 'Looking-for-work mode: craft a concise STAR-structured response with clear situation, task, action, and result.',
  },
  job_resume_alignment: {
    id: 'job_resume_alignment',
    label: 'Resume Alignment',
    icon: '📄',
    intent: 'clarify',
    source: 'Resume Alignment',
    analyticsKey: 'job_resume_alignment',
    additionalContext: 'Looking-for-work mode: align the answer to the candidate resume, highlight relevant experience, and tighten fit to the role.',
  },
  job_confidence: {
    id: 'job_confidence',
    label: 'Confidence Coaching',
    icon: '🗣️',
    intent: 'brainstorm',
    source: 'Confidence Coaching',
    analyticsKey: 'job_confidence',
    additionalContext: 'Looking-for-work mode: coach tone and delivery. Make the answer sound confident, grounded, and polished without sounding robotic.',
  },
  job_improvement: {
    id: 'job_improvement',
    label: 'Behavioral Optimize',
    icon: '📈',
    intent: 'follow_up_questions',
    source: 'Behavioral Optimization',
    analyticsKey: 'job_improvement',
    additionalContext: 'Looking-for-work mode: identify weak spots in the answer and suggest the strongest improvement or follow-up point to add next.',
  },
  system_tradeoffs: {
    id: 'system_tradeoffs',
    label: 'Tradeoffs',
    icon: '⚖️',
    intent: 'what_to_answer',
    source: 'System Tradeoffs',
    analyticsKey: 'system_tradeoffs',
    additionalContext: 'System design mode: focus on tradeoffs, scalability, latency, throughput, reliability, and architecture choices.',
    profilePreference: 'force_off',
  },
  system_clarify: {
    id: 'system_clarify',
    label: 'Clarify',
    icon: '❓',
    intent: 'clarify',
    source: 'System Clarify',
    analyticsKey: 'system_clarify',
    additionalContext: 'System design mode: clarify the key requirement, bottleneck, or constraint before going deeper.',
    profilePreference: 'force_off',
  },
  system_approaches: {
    id: 'system_approaches',
    label: 'Approaches',
    icon: '🧠',
    intent: 'brainstorm',
    source: 'System Approaches',
    analyticsKey: 'system_approaches',
    additionalContext: 'System design mode: brainstorm viable architectures and compare them briefly.',
    profilePreference: 'force_off',
  },
  system_deep_dive: {
    id: 'system_deep_dive',
    label: 'Deep Dive',
    icon: '🔍',
    intent: 'follow_up_questions',
    source: 'System Deep Dive',
    analyticsKey: 'system_deep_dive',
    additionalContext: 'System design mode: suggest the best deeper-dive question about scaling, data model, caching, reliability, or operations.',
    profilePreference: 'force_off',
  },
  salary_negotiate: {
    id: 'salary_negotiate',
    label: 'Negotiate',
    icon: '🤝',
    intent: 'what_to_answer',
    source: 'Salary Negotiation',
    analyticsKey: 'salary_negotiate',
    additionalContext: 'Salary negotiation mode: help the candidate craft a confident, professional negotiation response. Focus on anchoring high, value framing, total compensation framing, and avoiding premature commitment. Keep it concise and actionable.',
  },
  salary_counter: {
    id: 'salary_counter',
    label: 'Counter',
    icon: '💰',
    intent: 'brainstorm',
    source: 'Counter Offer Strategy',
    analyticsKey: 'salary_counter',
    additionalContext: 'Salary negotiation mode: suggest counter-offer strategies. Include specific phrasing, leverage points, and how to present the counter without damaging the relationship. Factor in base, equity, signing bonus, and other levers.',
  },
  salary_confidence: {
    id: 'salary_confidence',
    label: 'Confidence',
    icon: '🗣️',
    intent: 'clarify',
    source: 'Confidence Coaching',
    analyticsKey: 'salary_confidence',
    additionalContext: 'Salary negotiation mode: coach the candidate on tone, delivery, and confidence. Help them sound professional, grounded, and assertive without being aggressive. Suggest specific phrases and body language cues.',
  },
  salary_anchor: {
    id: 'salary_anchor',
    label: 'Anchor',
    icon: '⚓',
    intent: 'follow_up_questions',
    source: 'Anchoring Strategy',
    analyticsKey: 'salary_anchor',
    additionalContext: 'Salary negotiation mode: suggest the best anchoring strategy. Help set the right initial number, explain the psychology of anchoring, and provide talking points for justifying the anchor with market data and personal value.',
  },
};

const DEFAULT_DYNAMIC_ACTIONS = (brainstormEnabled: boolean): OverlayQuickActionId[] => [
  'what_to_answer',
  'clarify',
  brainstormEnabled ? 'brainstorm' : 'recap',
  'follow_up_questions',
];

const CONFIGS: Record<OverlayCopilotModeId, OverlayModeConfig> = {
  general: {
    actionIds: DEFAULT_DYNAMIC_ACTIONS,
    recommendedRules: [
      { actionId: 'answer_now', patterns: [/tell me about yourself/i, /introduce yourself/i] },
      { actionId: 'recap', patterns: [/\bsummari[sz]e\b/i, /\brecap\b/i, /\boverview\b/i, /\btl;dr\b/i] },
      { actionId: 'clarify', patterns: [/explain/i, /what is/i, /how does/i, /how do/i, /clarif/i, /mean by/i] },
      { actionId: 'follow_up_questions', patterns: [/\bfollow.?up\b/i, /\bnext\b/i, /then what/i] },
    ],
    defaultRecommendedActionId: 'what_to_answer',
  },
  behavioral: {
    actionIds: DEFAULT_DYNAMIC_ACTIONS,
    recommendedRules: [
      { actionId: 'answer_now', patterns: [/tell me about yourself/i, /introduce yourself/i] },
      { actionId: 'follow_up_questions', patterns: [/\bfollow.?up\b/i, /\bnext\b/i, /then what/i] },
      { actionId: 'what_to_answer', patterns: [/\bexample\b/i, /\bexperience\b/i, /\bproject\b/i, /\bchallenge\b/i, /\bimpact\b/i] },
    ],
    defaultRecommendedActionId: 'what_to_answer',
  },
  coding: {
    actionIds: ['tech_hint', 'tech_optimal_solution', 'tech_complexity', 'tech_edge_case'],
    recommendedRules: [
      { actionId: 'tech_complexity', patterns: [/complex/i, /big o/i, /time complex/i, /space complex/i, /runtime/i, /efficien/i] },
      { actionId: 'tech_edge_case', patterns: [/edge case/i, /corner case/i, /test case/i, /empty input/i, /null/i] },
      { actionId: 'tech_hint', patterns: [/hint/i, /stuck/i, /debug/i, /error/i, /bug/i, /struggl/i, /nudge/i] },
      { actionId: 'tech_optimal_solution', patterns: [/optimal/i, /optimi[sz]/i, /best/i, /efficien/i, /implement/i, /algorithm/i, /solve/i, /write (?:a )?function/i, /how would you/i, /data struct/i] },
    ],
    defaultRecommendedActionId: 'tech_optimal_solution',
  },
  follow_up: {
    actionIds: ['what_to_answer', 'clarify', 'recap', 'follow_up_questions'],
    recommendedRules: [
      { actionId: 'follow_up_questions', patterns: [/\bfollow.?up\b/i, /\bnext\b/i, /then what/i] },
      { actionId: 'clarify', patterns: [/\bclarify\b/i, /\brepeat\b/i, /\bagain\b/i] },
    ],
    defaultRecommendedActionId: 'follow_up_questions',
  },
  system_design: {
    actionIds: ['system_tradeoffs', 'system_clarify', 'system_approaches', 'system_deep_dive'],
    recommendedRules: [
      { actionId: 'system_tradeoffs', patterns: [/trade[\s-]?off/i, /scale/i, /scalab/i, /latency/i, /throughput/i, /reliab/i, /system design/i, /traffic/i, /users/i] },
      { actionId: 'system_clarify', patterns: [/clarif/i, /constraint/i, /requirement/i, /functional/i, /scope/i, /assumption/i] },
      { actionId: 'system_approaches', patterns: [/approach/i, /architect/i, /high level/i, /design pattern/i, /component/i] },
      { actionId: 'system_deep_dive', patterns: [/deep dive/i, /detail/i, /ops/i, /cache/i, /data model/i, /shard/i, /database/i, /storage/i] },
    ],
    defaultRecommendedActionId: 'system_tradeoffs',
  },
  'technical-interview': {
    actionIds: ['tech_hint', 'tech_optimal_solution', 'tech_complexity', 'tech_edge_case'],
    recommendedRules: [
      { actionId: 'tech_complexity', patterns: [/complex/i, /big o/i, /time complex/i, /space complex/i, /runtime/i] },
      { actionId: 'tech_edge_case', patterns: [/edge case/i, /corner case/i, /test case/i, /input/i] },
      { actionId: 'tech_hint', patterns: [/hint/i, /stuck/i, /debug/i, /error/i, /bug/i, /struggl/i] },
      { actionId: 'tech_optimal_solution', patterns: [/optimal/i, /optimi[sz]/i, /best/i, /efficien/i, /approach/i, /solve/i, /implement/i] },
    ],
    defaultRecommendedActionId: 'tech_optimal_solution',
  },
  sales: {
    actionIds: ['sales_objection', 'sales_pricing', 'sales_discovery', 'sales_negotiation'],
    recommendedRules: [
      { actionId: 'sales_pricing', patterns: [/price/i, /pricing/i, /cost/i, /budget/i, /discount/i, /roi/i, /expensive/i, /quote/i] },
      { actionId: 'sales_negotiation', patterns: [/negotia/i, /discount/i, /procurement/i, /terms/i, /contract/i, /deal/i] },
      { actionId: 'sales_objection', patterns: [/objection/i, /concern/i, /too expensive/i, /not sure/i, /hesitant/i, /pushback/i, /push back/i] },
      { actionId: 'sales_discovery', patterns: [/pain/i, /problem/i, /challenge/i, /workflow/i, /goal/i, /need/i, /use case/i] },
    ],
    defaultRecommendedActionId: 'sales_objection',
  },
  lecture: {
    actionIds: ['lecture_explain', 'lecture_summary', 'lecture_takeaway', 'lecture_question'],
    recommendedRules: [
      { actionId: 'lecture_question', patterns: [/\bquestion\b/i, /\bconfused\b/i, /\bclarify\b/i, /\bwhy\b/i] },
      { actionId: 'lecture_summary', patterns: [/\bsummari[sz]e\b/i, /\brecap\b/i, /\boverview\b/i] },
      { actionId: 'lecture_takeaway', patterns: [/\btakeaway\b/i, /\bkey point\b/i, /\bimportant\b/i] },
      { actionId: 'lecture_explain', patterns: [/\bexplain\b/i, /\bwhat is\b/i, /\bhow does\b/i, /\bconcept\b/i] },
    ],
    defaultRecommendedActionId: 'lecture_explain',
  },
  recruiting: {
    actionIds: ['recruiting_strength', 'recruiting_red_flag', 'recruiting_follow_up', 'recruiting_evaluation'],
    recommendedRules: [
      { actionId: 'recruiting_red_flag', patterns: [/\bred flag\b/i, /\bconcern\b/i, /\brisk\b/i, /\bweakness\b/i] },
      { actionId: 'recruiting_follow_up', patterns: [/\bfollow.?up\b/i, /\bprobe\b/i, /\bverify\b/i, /\bnext question\b/i] },
      { actionId: 'recruiting_evaluation', patterns: [/\bfit\b/i, /\brecommend\b/i, /\bhire\b/i, /\blevel\b/i] },
      { actionId: 'recruiting_strength', patterns: [/\bstrength\b/i, /\bstrong\b/i, /\bsignal\b/i, /\bevidence\b/i] },
    ],
    defaultRecommendedActionId: 'recruiting_strength',
  },
  'team-meet': {
    actionIds: ['team_decision', 'team_action_item', 'team_risk', 'team_owner'],
    recommendedRules: [
      { actionId: 'team_action_item', patterns: [/\baction item\b/i, /\bnext step\b/i, /\btodo\b/i, /\bfollow up\b/i] },
      { actionId: 'team_risk', patterns: [/\bblocker\b/i, /\brisk\b/i, /\bissue\b/i, /\bdependency\b/i] },
      { actionId: 'team_owner', patterns: [/\bowner\b/i, /\bassign\b/i, /\bwho owns\b/i, /\bresponsible\b/i] },
      { actionId: 'team_decision', patterns: [/\bdecision\b/i, /\bdecide\b/i, /\bagreed\b/i, /\bplan\b/i] },
    ],
    defaultRecommendedActionId: 'team_action_item',
  },
  'looking-for-work': {
    actionIds: ['job_star', 'job_resume_alignment', 'job_confidence', 'job_improvement'],
    recommendedRules: [
      { actionId: 'answer_now', patterns: [/tell me about yourself/i, /introduce yourself/i] },
      { actionId: 'job_star', patterns: [/\btell me about a time\b/i, /\bexample\b/i, /\bbehavioral\b/i, /\bchallenge\b/i] },
      { actionId: 'job_resume_alignment', patterns: [/\bresume\b/i, /\bbackground\b/i, /\bexperience\b/i, /\brole\b/i] },
      { actionId: 'job_confidence', patterns: [/\bnervous\b/i, /\bconfidence\b/i, /\bdelivery\b/i, /\bhow do i sound\b/i] },
      { actionId: 'job_improvement', patterns: [/\bimprove\b/i, /\bbetter\b/i, /\bweak\b/i, /\boptimi[sz]e\b/i] },
    ],
    defaultRecommendedActionId: 'job_star',
  },
  salary: {
    actionIds: ['salary_negotiate', 'salary_counter', 'salary_confidence', 'salary_anchor'],
    recommendedRules: [
      { actionId: 'salary_negotiate', patterns: [/negotiat/i, /salary/i, /compensation/i, /comp/i, /ctc/i, /package/i, /offer/i] },
      { actionId: 'salary_counter', patterns: [/counter/i, /too low/i, /increase/i, /raise/i, /more/i, /higher/i, /bump/i] },
      { actionId: 'salary_confidence', patterns: [/nervous/i, /confident/i, /how.*say/i, /what.*say/i, /phrasing/i, /tone/i] },
      { actionId: 'salary_anchor', patterns: [/anchor/i, /first number/i, /range/i, /market rate/i, /band/i, /expect/i] },
    ],
    defaultRecommendedActionId: 'salary_negotiate',
  },
};

export function resolveOverlayCopilotMode(
  activeTemplateType: ModeTemplateId | null | undefined,
  sessionMode: SessionOverlayMode,
): OverlayCopilotModeId {
  // Non-interview templates always lock to their own button set.
  // Transcript intent (including salary) influences highlight only, never buttons.
  if (activeTemplateType === 'sales' || activeTemplateType === 'lecture' || activeTemplateType === 'recruiting' || activeTemplateType === 'team-meet') {
    return activeTemplateType;
  }

  // Technical-interview: dynamic sub-mode — transcript selects button set.
  // Salary passthrough allowed here because this is an adaptive template.
  if (activeTemplateType === 'technical-interview') {
    if (sessionMode === 'salary') return 'salary';
    if (sessionMode === 'coding') return 'coding';
    if (sessionMode === 'system_design') return 'system_design';
    if (sessionMode === 'behavioral') return 'behavioral';
    if (sessionMode === 'follow_up') return 'follow_up';
    if (sessionMode === 'general') return 'general';
    return 'technical-interview';
  }

  // Looking-for-work: dynamic sub-mode for coding / system_design / salary.
  if (activeTemplateType === 'looking-for-work') {
    if (sessionMode === 'salary') return 'salary';
    if (sessionMode === 'coding') return 'coding';
    if (sessionMode === 'system_design') return 'system_design';
    return 'looking-for-work';
  }

  // All other templates (general, etc.): template is authoritative.
  // Transcript intent influences button highlight, never button set.
  return activeTemplateType || 'general';
}

export function getOverlayQuickActions(
  modeId: OverlayCopilotModeId,
  brainstormEnabled: boolean,
): OverlayQuickActionDef[] {
  const config = CONFIGS[modeId] ?? CONFIGS.general;
  const actionIds = typeof config.actionIds === 'function'
    ? config.actionIds(brainstormEnabled)
    : config.actionIds;
  return actionIds.map((id) => ACTIONS[id]);
}

export function getMatchedRecommendedOverlayAction(
  modeId: OverlayCopilotModeId,
  combinedText: string,
): OverlayRecommendationId | null {
  if (!combinedText.trim()) return null;
  const config = CONFIGS[modeId] ?? CONFIGS.general;

  for (const rule of config.recommendedRules) {
    if (rule.patterns.some((pattern) => pattern.test(combinedText))) {
      return rule.actionId;
    }
  }

  return null;
}

export function getRecommendedOverlayAction(
  modeId: OverlayCopilotModeId,
  combinedText: string,
): OverlayRecommendationId {
  const matched = getMatchedRecommendedOverlayAction(modeId, combinedText);
  if (matched) return matched;

  const config = CONFIGS[modeId] ?? CONFIGS.general;
  return config.defaultRecommendedActionId;
}

export { resolveRecommendedOverlayAction } from '../overlay/overlayRecommendationResolver.ts';
