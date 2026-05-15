import type {
  ModeTemplateId,
  PublicModeTemplate,
  UserModeNoteSection,
} from './types';

export const MODE_TEMPLATE_CATALOG: PublicModeTemplate[] = [
  {
    id: 'general',
    name: 'General',
    icon: 'sparkles',
    description: 'Adaptive everyday copilot for broad conversations, meetings, and Q&A.',
    userPromptPlaceholder: 'Tell TeamSync how to respond during the conversation.',
    notesTemplate: [
      { id: 'summary', title: 'Summary', description: 'High-level summary of the conversation.' },
      { id: 'action-items', title: 'Action Items', description: 'Tasks, owners, and follow-ups identified.' },
      { id: 'key-points', title: 'Key Points', description: 'Important points, context, and decisions discussed.' },
    ],
    suggestedReferenceFiles: ['Agenda', 'Context doc', 'Prep notes'],
    intelligenceType: 'adaptive',
  },
  {
    id: 'sales',
    name: 'Sales',
    icon: 'briefcase',
    description: 'Close deals with strategic discovery, objection handling, and next-step momentum.',
    userPromptPlaceholder: 'Add product context, deal stage, pricing guardrails, or prospect-specific notes.',
    notesTemplate: [
      { id: 'sales-action-items', title: 'Action Items', description: 'Follow-ups, owners, and deadlines from the sales conversation.' },
      { id: 'sales-outcome', title: 'Outcome', description: 'Current deal status, commitment level, and next milestone.' },
      { id: 'sales-discovery', title: 'Discovery', description: 'Budget, timeline, pain points, and buying criteria uncovered.' },
      { id: 'sales-objections', title: 'Objections', description: 'Questions, risks, and concerns that need to be handled.' },
    ],
    suggestedReferenceFiles: ['Pricing sheet', 'Product one-pager', 'Account plan'],
    intelligenceType: 'sales',
  },
  {
    id: 'recruiting',
    name: 'Recruiting',
    icon: 'users',
    description: 'Evaluate candidates with structured interview signal, calibration, and follow-up notes.',
    userPromptPlaceholder: 'Add role requirements, hiring bar, red flags, or interview focus areas.',
    notesTemplate: [
      { id: 'recruiting-action-items', title: 'Action Items', description: 'Next steps for the recruiter, panel, or candidate.' },
      { id: 'recruiting-signal', title: 'Signal Summary', description: 'Overall candidate signal, strengths, and open concerns.' },
      { id: 'recruiting-skills', title: 'Experience and Skills', description: 'Relevant experience, domain depth, and examples discussed.' },
      { id: 'recruiting-role-fit', title: 'Role Fit', description: 'Alignment to scope, level, expectations, and compensation.' },
    ],
    suggestedReferenceFiles: ['Job description', 'Scorecard', 'Candidate resume'],
    intelligenceType: 'recruiting',
  },
  {
    id: 'team-meet',
    name: 'Team Meet',
    icon: 'messages-square',
    description: 'Track action items, decisions, blockers, and team updates from recurring meetings.',
    userPromptPlaceholder: 'Add team context, project names, recurring goals, or stakeholder expectations.',
    notesTemplate: [
      { id: 'team-summary', title: 'Summary', description: 'Top-level recap of the meeting and why it mattered.' },
      { id: 'team-action-items', title: 'Action Items', description: 'Tasks, owners, and due dates agreed in the meeting.' },
      { id: 'team-decisions', title: 'Decisions Made', description: 'Key decisions, approvals, and tradeoffs recorded.' },
      { id: 'team-blockers', title: 'Challenges or Blockers', description: 'Risks, blockers, or dependencies raised by the team.' },
    ],
    suggestedReferenceFiles: ['Previous notes', 'Roadmap', 'Project brief'],
    intelligenceType: 'team_meeting',
  },
  {
    id: 'looking-for-work',
    name: 'Looking for Work',
    icon: 'search',
    description: 'Answer interview questions with confidence, narrative clarity, and role-specific grounding.',
    userPromptPlaceholder: 'Add interview goals, target roles, story angles, or companies you are focusing on.',
    notesTemplate: [
      { id: 'lfw-overview', title: 'Overview', description: 'Interview flow, company context, and overall impression.' },
      { id: 'lfw-questions', title: 'Questions and Responses', description: 'Questions asked and the substance of your answers.' },
      { id: 'lfw-followups', title: 'Follow-up Actions', description: 'Materials to send, next rounds, and outreach commitments.' },
      { id: 'lfw-improvements', title: 'Areas to Improve', description: 'Moments to sharpen before the next conversation.' },
    ],
    suggestedReferenceFiles: ['Resume', 'Job description', 'Company research'],
    intelligenceType: 'interview',
  },
  {
    id: 'lecture',
    name: 'Lecture',
    icon: 'book-open',
    description: 'Capture key concepts, frameworks, and study-ready notes from lectures or training sessions.',
    userPromptPlaceholder: 'Add course level, subject focus, terminology preferences, or study goals.',
    notesTemplate: [
      { id: 'lecture-topic', title: 'Topic', description: 'Main subject or focus of the lecture.' },
      { id: 'lecture-key-concepts', title: 'Key Concepts', description: 'Definitions, models, and ideas worth retaining.' },
      { id: 'lecture-detailed-notes', title: 'Detailed Notes', description: 'Structured detail from the lecture, examples, and supporting context.' },
      { id: 'lecture-follow-up', title: 'Follow-up Work', description: 'Assignments, study tasks, and open questions to revisit.' },
    ],
    suggestedReferenceFiles: ['Lecture slides', 'Syllabus', 'Reading notes'],
    intelligenceType: 'lecture',
  },
  {
    id: 'technical-interview',
    name: 'Technical Interview',
    icon: 'code-2',
    description: 'Ace DSA, system design, and coding rounds with structured technical reasoning.',
    userPromptPlaceholder: 'Add interview focus areas, target companies, preferred language, or topics to emphasize.',
    notesTemplate: [
      { id: 'tech-problems', title: 'Problems Covered', description: 'Questions asked, approaches taken, and final outcomes.' },
      { id: 'tech-concepts', title: 'Concepts Tested', description: 'Algorithms, data structures, or system design themes discussed.' },
      { id: 'tech-wins', title: 'What Went Well', description: 'Clear wins, strong explanations, or good tradeoff calls.' },
      { id: 'tech-study', title: 'Areas to Study', description: 'Gaps, edge cases, or topics to prepare more deeply.' },
    ],
    suggestedReferenceFiles: ['Resume', 'Job description', 'Prep notes'],
    intelligenceType: 'technical_interview',
  },
];

export const MODE_TEMPLATE_MAP: Record<ModeTemplateId, PublicModeTemplate> = MODE_TEMPLATE_CATALOG.reduce(
  (acc, template) => {
    acc[template.id] = template;
    return acc;
  },
  {} as Record<ModeTemplateId, PublicModeTemplate>
);

export function cloneModeTemplateSections(templateId: ModeTemplateId): UserModeNoteSection[] {
  const template = MODE_TEMPLATE_MAP[templateId];
  return template.notesTemplate.map((section) => ({
    id: `${template.id}-${section.id}`,
    title: section.title,
    description: section.description,
  }));
}
