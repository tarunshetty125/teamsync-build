import {
    MODE_GENERAL_PROMPT,
    MODE_LOOKING_FOR_WORK_PROMPT,
    MODE_SALES_PROMPT,
    MODE_RECRUITING_PROMPT,
    MODE_TEAM_MEET_PROMPT,
    MODE_LECTURE_PROMPT,
    MODE_TECHNICAL_INTERVIEW_PROMPT,
    MODE_GENERAL_SUFFIX,
    MODE_LOOKING_FOR_WORK_SUFFIX,
    MODE_SALES_SUFFIX,
    MODE_RECRUITING_SUFFIX,
    MODE_TEAM_MEET_SUFFIX,
    MODE_LECTURE_SUFFIX,
    MODE_TECHNICAL_INTERVIEW_SUFFIX,
} from '../llm/prompts';
import { MODE_TEMPLATE_CATALOG, MODE_TEMPLATE_MAP } from '../../src/lib/modes/templateCatalog';
import type {
    BuiltInModeTemplate,
    ModeTemplateId,
    PublicModeTemplate,
} from '../../src/lib/modes/types';

const TEMPLATE_PROMPTS: Record<ModeTemplateId, { prompt: string; suffix: string }> = {
    general: {
        prompt: MODE_GENERAL_PROMPT,
        suffix: MODE_GENERAL_SUFFIX,
    },
    sales: {
        prompt: MODE_SALES_PROMPT,
        suffix: MODE_SALES_SUFFIX,
    },
    recruiting: {
        prompt: MODE_RECRUITING_PROMPT,
        suffix: MODE_RECRUITING_SUFFIX,
    },
    'team-meet': {
        prompt: MODE_TEAM_MEET_PROMPT,
        suffix: MODE_TEAM_MEET_SUFFIX,
    },
    'looking-for-work': {
        prompt: MODE_LOOKING_FOR_WORK_PROMPT,
        suffix: MODE_LOOKING_FOR_WORK_SUFFIX,
    },
    lecture: {
        prompt: MODE_LECTURE_PROMPT,
        suffix: MODE_LECTURE_SUFFIX,
    },
    'technical-interview': {
        prompt: MODE_TECHNICAL_INTERVIEW_PROMPT,
        suffix: MODE_TECHNICAL_INTERVIEW_SUFFIX,
    },
};

export const BUILT_IN_MODE_TEMPLATES: BuiltInModeTemplate[] = MODE_TEMPLATE_CATALOG.map((template) => ({
    ...template,
    builtInPrompt: TEMPLATE_PROMPTS[template.id].prompt,
    builtInPromptSuffix: TEMPLATE_PROMPTS[template.id].suffix,
}));

export const BUILT_IN_MODE_TEMPLATE_MAP: Record<ModeTemplateId, BuiltInModeTemplate> = BUILT_IN_MODE_TEMPLATES.reduce(
    (acc, template) => {
        acc[template.id] = template;
        return acc;
    },
    {} as Record<ModeTemplateId, BuiltInModeTemplate>
);

export function getPublicModeTemplates(): PublicModeTemplate[] {
    return MODE_TEMPLATE_CATALOG.map((template) => ({
        ...template,
        notesTemplate: template.notesTemplate.map((section) => ({ ...section })),
        suggestedReferenceFiles: [...template.suggestedReferenceFiles],
    }));
}

export function getBuiltInModeTemplate(templateId: ModeTemplateId): BuiltInModeTemplate {
    return BUILT_IN_MODE_TEMPLATE_MAP[templateId] ?? {
        ...MODE_TEMPLATE_MAP.general,
        builtInPrompt: MODE_GENERAL_PROMPT,
        builtInPromptSuffix: MODE_GENERAL_SUFFIX,
    };
}
