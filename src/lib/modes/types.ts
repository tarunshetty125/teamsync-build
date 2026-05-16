export type ModeTemplateId =
  | 'general'
  | 'sales'
  | 'recruiting'
  | 'team-meet'
  | 'looking-for-work'
  | 'lecture'
  | 'technical-interview';

export type ModeTemplateIcon =
  | 'sparkles'
  | 'briefcase'
  | 'users'
  | 'messages-square'
  | 'search'
  | 'book-open'
  | 'code-2';

export type ModeIntelligenceType =
  | 'adaptive'
  | 'sales'
  | 'recruiting'
  | 'team_meeting'
  | 'interview'
  | 'lecture'
  | 'technical_interview';

export interface ModeNoteSectionTemplate {
  id: string;
  title: string;
  description: string;
}

export interface PublicModeTemplate {
  id: ModeTemplateId;
  name: string;
  icon: ModeTemplateIcon;
  description: string;
  userPromptPlaceholder: string;
  /** Pre-filled starter prompt shipped with TeamSync templates. Used as the initial userPrompt when creating a mode from this template. */
  defaultUserPrompt?: string;
  notesTemplate: ModeNoteSectionTemplate[];
  suggestedReferenceFiles: string[];
  intelligenceType: ModeIntelligenceType;
}

export interface BuiltInModeTemplate extends PublicModeTemplate {
  builtInPrompt: string;
  builtInPromptSuffix: string;
}

export interface ModeReferenceFile {
  id: string;
  fileName: string;
  filePath?: string | null;
  content: string;
  createdAt: string;
}

export interface UserModeNoteSection {
  id: string;
  title: string;
  description: string;
}

export interface UserMode {
  id: string;
  templateId: ModeTemplateId;
  name: string;
  userPrompt: string;
  referenceFiles: ModeReferenceFile[];
  notesTemplate: UserModeNoteSection[];
  createdAt: string;
  updatedAt: string;
}

export interface ModesStateSnapshot {
  templates: PublicModeTemplate[];
  userModes: UserMode[];
  selectedModeId: string | null;
  activeModeId: string | null;
}
