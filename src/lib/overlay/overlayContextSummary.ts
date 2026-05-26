const MODE_LABELS: Record<string, string> = {
    behavioral: 'Behavioral interview',
    coding: 'Technical coding',
    system_design: 'System design',
    general: 'General discussion',
    follow_up: 'Follow-up discussion',
    sales: 'Sales conversation',
    lecture: 'Lecture / learning',
    recruiting: 'Candidate evaluation',
    'team-meet': 'Team meeting',
    'looking-for-work': 'Job interview prep',
    'technical-interview': 'Technical interview',
};

const TOPIC_KEYWORDS: [RegExp, string][] = [
    [/\b(docker|kubernetes|k8s|container)/i, 'Docker/Kubernetes'],
    [/\b(binary search|sorting|linked list|tree|graph|hash.?map)/i, 'data structures'],
    [/\b(salary|compensation|ctc|package|offer)\b/i, 'compensation'],
    [/\b(strengths?|weakness|experience|challenge)\b/i, 'strengths and experience'],
    [/\b(scalab|load.?balanc|caching|microservice)/i, 'scalability'],
    [/\b(react|angular|vue|next\.?js|typescript)/i, 'frontend frameworks'],
    [/\b(aws|gcp|azure|cloud)/i, 'cloud infrastructure'],
    [/\b(sql|database|postgres|mongo|redis)/i, 'data systems'],
    [/\b(python|java|golang|rust|c\+\+)/i, 'programming languages'],
    [/\b(api|rest|graphql|grpc)/i, 'API design'],
    [/\b(testing|unit test|integration test|tdd)/i, 'testing'],
    [/\b(leadership|team lead|managed|mentor)/i, 'leadership'],
    [/\b(agile|scrum|sprint|kanban)/i, 'agile methodology'],
];

export function deriveContextSummary(
    mode: string,
    recentTranscript: string,
): { label: string; detail: string } {
    const modeLabel = MODE_LABELS[mode] || 'Discussion';
    for (const [regex, replacement] of TOPIC_KEYWORDS) {
        if (regex.test(recentTranscript)) {
            return { label: modeLabel, detail: replacement };
        }
    }
    const wordCount = recentTranscript.trim().split(/\s+/).filter(Boolean).length;
    const detail = wordCount > 5 ? 'Analyzing conversation…' : 'Listening for context…';
    return { label: modeLabel, detail };
}
