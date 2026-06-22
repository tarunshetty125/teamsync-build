import { ProjectEntry, EducationEntry } from './types';

export function mapToStructuredProjects(projects?: any[]): ProjectEntry[] {
    if (!Array.isArray(projects)) return [];
    return projects.map((p: any) => ({
        name: (p?.title ?? p?.name ?? '').toString().trim(),
        description: (p?.description ?? p?.desc ?? '').toString().trim(),
        technologies: Array.isArray(p?.technologies)
            ? p.technologies.map(String).map((s: string) => s.trim()).filter(Boolean)
            : (p?.technologies ? String(p.technologies).split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        url: p?.url || p?.link || undefined,
    }));
}

export function mapToStructuredEducation(education?: any[]): EducationEntry[] {
    if (!Array.isArray(education)) return [];
    return education.map((ed: any) => ({
        institution: ed?.institution ?? '',
        degree: ed?.degree ?? '',
        field: ed?.field ?? ed?.major ?? '',
        start_date: ed?.startDate ?? ed?.start_date ?? ed?.start ?? null,
        end_date: ed?.endDate ?? ed?.end_date ?? ed?.end ?? null,
        gpa: ed?.gpa ?? undefined,
    }));
}
