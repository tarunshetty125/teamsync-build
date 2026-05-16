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
    defaultUserPrompt: [
      'I want clear, actionable answers — not lectures.',
      'When I\'m asked a question in a meeting, give me what to say in first person.',
      'When tracking a conversation, surface decisions, action items, and blockers — skip filler.',
      'If something technical comes up, explain it simply and move on.',
      'Match my tone: professional but natural. Never sound robotic.',
    ].join('\n'),
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
    defaultUserPrompt: [
      'I sell B2B SaaS solutions to mid-market and enterprise accounts.',
      'My style is consultative — I lead with discovery, not pitching.',
      'Help me handle objections smoothly: acknowledge the concern, reframe toward value, then advance with a question.',
      'When a buying signal appears, help me propose a concrete next step immediately.',
      'Never sound pushy or scripted. Sound like a trusted advisor who genuinely understands their problem.',
      'If pricing comes up, anchor on value first ("teams like yours typically save X"), then state the number confidently.',
      'Always end with a clear next step — never leave a conversation without one.',
    ].join('\n'),
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
    defaultUserPrompt: [
      'I\'m interviewing candidates for technical and non-technical roles.',
      'Help me read signal accurately: ownership vs team credit, specifics vs generalizations, real depth vs rehearsed answers.',
      'When a candidate gives a vague answer, suggest a follow-up probe that gets to the truth.',
      'Track hire signal throughout: Strong Yes / Lean Yes / Lean No / Strong No — with evidence.',
      'Good questions reveal capability: "Walk me through the hardest decision you made on that project."',
      'Flag inconsistencies between what they claim and what they demonstrate.',
      'Keep assessments analytical and bias-aware. Focus on what was said, not how it sounded.',
    ].join('\n'),
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
    defaultUserPrompt: [
      'I\'m in recurring team meetings — standups, planning sessions, retros, strategy reviews, and 1:1s.',
      'Capture action items with owners and deadlines: "📋 Sarah to finalize Q3 deck by Friday."',
      'Track decisions as they happen: "✅ Pushed launch to Oct 15 due to API delays."',
      'Surface blockers and risks: "⚠️ Stripe migration still blocked on legal clearance."',
      'When I\'m called on, give me what to say — lead with status, mention the next milestone, flag anything at risk.',
      'Don\'t generate noise when nothing notable is happening. Silence is fine.',
      'If the meeting goes off-track, note it but don\'t interrupt the flow.',
    ].join('\n'),
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
    defaultUserPrompt: [
      'I\'m actively interviewing for roles and need to sound confident, specific, and natural.',
      'For behavioral questions: answer in first person using STAR structure — Situation, Task, Action, Result. Lead with impact.',
      'For "Why this role?" questions: bridge my background to their specific requirements. Be genuine, not generic.',
      'For salary/offer discussions: anchor high, justify with market data, and never give a number first.',
      'Help me sound like a strong, prepared candidate — not someone reading from a script.',
      'When I don\'t know something, help me own it: "I haven\'t worked with that specifically, but here\'s how I\'d approach it."',
      'After every answer, I should sound like someone they want on their team.',
    ].join('\n'),
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
    defaultUserPrompt: [
      'I\'m attending lectures, classes, or training sessions and need real-time learning support.',
      'When a new concept is introduced, explain it peer-to-peer: "Basically this means X. It matters because Y. Think of it like Z."',
      'For formulas and equations: render in LaTeX, define variables, then give the intuition in plain language.',
      'If the professor asks the class a question, give me a confident, accurate answer I can say.',
      'Capture key points sparingly — only flag what\'s genuinely worth writing down.',
      'Match the depth to my level. An intro course needs different explanations than an advanced seminar.',
      'Use the course\'s own definitions and framing — don\'t contradict what I\'ll be tested on.',
    ].join('\n'),
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
    defaultUserPrompt: [
      'I\'m in a live technical interview — coding, DSA, or system design round.',
      'For coding questions: think out loud first ("My instinct is to use a hash map here..."), then give full working code with inline comments.',
      'Always include: Time complexity, Space complexity, Why this approach, and Edge cases I checked.',
      'For system design: start with constraints (scale, read/write ratio, consistency vs availability), then diagram components, drill into the hard parts.',
      'When stuck: state the brute force first, identify the key insight, then propose the optimal approach.',
      'For behavioral questions during a tech round: keep it under 30 seconds — brief story, outcome, back to code.',
      'Sound like a confident engineer reasoning through a problem, not reciting a textbook.',
    ].join('\n'),
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
