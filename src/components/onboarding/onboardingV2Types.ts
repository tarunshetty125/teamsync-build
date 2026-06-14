export type PersonaId =
  | 'interview_preparation'
  | 'meetings_calls'
  | 'developer'
  | 'explore_quietly';

export type IndustryId =
  | 'engineering'
  | 'cloud_computing'
  | 'devops'
  | 'data_analytics'
  | 'design'
  | 'finance'
  | 'marketing'
  | 'product'
  | 'sales'
  | 'recruiting'
  | 'operations'
  | 'hr'
  | 'management'
  | 'student'
  | 'other';

export type DiscoverySourceId =
  | 'google'
  | 'linkedin'
  | 'youtube'
  | 'twitter_x'
  | 'friend'
  | 'reddit'
  | 'email'
  | 'other';

export type FirstSuccessActionId =
  | 'upload_resume_jd'
  | 'connect_calendar'
  | 'open_technical_interview_mode'
  | 'open_coding_mode'
  | 'start_first_session';

export type OnboardingV2State = {
  tourComplete: boolean;
  firstSuccess: {
    completed: boolean;
    action: FirstSuccessActionId | null;
    completedAt: string | null;
  };
};

export type OnboardingV2StatePatch = Partial<{
  tourComplete: boolean;
  firstSuccess: Partial<OnboardingV2State['firstSuccess']>;
}>;

export type GoogleAuthUserWithOnboardingV2 = {
  id?: string;
  googleId?: string;
  name: string;
  email: string;
  picture?: string;
  calendarConnected?: boolean;
  isNewUser?: boolean;
  onboardingV1?: {
    persona: string;
    industry: string;
    discoverySource: string;
    completedAt: string;
    onboardingVersion: 1;
    completedInVersion: string;
  } | null;
};

export const PERSONA_OPTIONS: Array<{
  id: PersonaId;
  label: string;
  description: string;
}> = [
  {
    id: 'interview_preparation',
    label: 'Interview Preparation',
    description: 'Live interviews, resume answers, and role-specific prep.',
  },
  {
    id: 'meetings_calls',
    label: 'Meetings & Calls',
    description: 'Team syncs, client calls, follow-ups, and notes.',
  },
  {
    id: 'developer',
    label: 'Developer',
    description: 'Coding rounds, system design, and technical discussions.',
  },
  {
    id: 'explore_quietly',
    label: 'Explore Quietly',
    description: 'Start broadly and discover where Quietly fits.',
  },
];

export const INDUSTRY_OPTIONS: Array<{ id: IndustryId; label: string }> = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'cloud_computing', label: 'Cloud Computing' },
  { id: 'devops', label: 'DevOps' },
  { id: 'data_analytics', label: 'Data Analytics' },
  { id: 'design', label: 'Design' },
  { id: 'finance', label: 'Finance' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'product', label: 'Product' },
  { id: 'sales', label: 'Sales' },
  { id: 'recruiting', label: 'Recruiting' },
  { id: 'operations', label: 'Operations' },
  { id: 'hr', label: 'HR' },
  { id: 'management', label: 'Management' },
  { id: 'student', label: 'Student' },
  { id: 'other', label: 'Other' },
];

export const DISCOVERY_OPTIONS: Array<{ id: DiscoverySourceId; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'twitter_x', label: 'X/Twitter' },
  { id: 'friend', label: 'Friend' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'email', label: 'Email' },
  { id: 'other', label: 'Other' },
];

export function normalizeOnboardingEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPersonaId(value: unknown): value is PersonaId {
  return PERSONA_OPTIONS.some((option) => option.id === value);
}

export function getPersonaLabel(persona: string | null | undefined): string {
  return PERSONA_OPTIONS.find((option) => option.id === persona)?.label ?? 'Quietly';
}
