export type SkillMetrics = {
    matched: number;
    gaps: number;
    total: number;
    matchPercent: number;
};

export function computeSkillMetrics(gapAnalysis: any): SkillMetrics {
    const matched = Array.isArray(gapAnalysis?.matched_skills)
        ? gapAnalysis.matched_skills.filter((skill: unknown) => typeof skill === 'string' && skill.trim().length > 0).length
        : 0;

    const gaps = Array.isArray(gapAnalysis?.gaps)
        ? gapAnalysis.gaps.filter((gap: unknown) => {
            if (typeof gap === 'string') return gap.trim().length > 0;
            if (gap && typeof gap === 'object') {
                const record = gap as Record<string, unknown>;
                return typeof record.skill === 'string' && record.skill.trim().length > 0;
            }
            return false;
        }).length
        : 0;

    const total = matched + gaps;
    const matchPercent = total > 0
        ? Math.round((matched / total) * 100)
        : 0;

    return {
        matched,
        gaps,
        total,
        matchPercent
    };
}
