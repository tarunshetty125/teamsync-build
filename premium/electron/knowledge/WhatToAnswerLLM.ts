import { DashboardExtractionResult } from './types';

/**
 * Build an LLM prompt that injects structured candidate data so answers are
 * grounded, personalized, and adapted based on extraction confidence.
 */
export function buildAnswerPrompt(question: string, structured: any): string {
    // Limit skills and projects to keep prompts small and focused
    const skillsArr = Array.isArray(structured?.skills) ? structured.skills.slice(0, 10) : [];
    const skills = skillsArr.length ? skillsArr.join(', ') : '';

    // Prefer project title + description for stronger grounding; limit to 2 projects
    const projectsArr = Array.isArray(structured?.projects)
        ? structured.projects.slice(0, 2)
              .map((p: any) => {
                  const title = p.title || p.name || '';
                  const desc = p.description || p.summary || '';
                  // Safe join to avoid 'undefined' leaking into prompts
                  return `${title}: ${desc || ''}`.trim();
              })
              .filter(Boolean)
        : [];

    const fieldConfidence = structured?.fieldConfidence || {
        skills: Array.isArray(structured?.skills) && structured.skills.length >= 5 ? 90 : 50,
        projects: Array.isArray(structured?.projects) && structured.projects.length > 0 ? 85 : 40,
        education: Array.isArray(structured?.education) && structured.education.length > 0 ? 80 : 40,
        experience: Array.isArray(structured?.experience) && structured.experience.length > 0 ? 80 : 30,
    };

    const matchInsights = structured?.matchInsights || {
        matchScore: 0,
        matchedSkills: [],
        missingSkills: [],
        strongProjects: [],
        weakAreas: [],
        talkingPoints: [],
    };

    const tone = (matchInsights.matchScore || 0) > 75 ? 'confident' : 'growth-oriented';
    const experienceWeak = (fieldConfidence.experience || 0) < 50;

    return [
        'You are answering using structured candidate data.',
        '',
        'SKILLS:',
        skills || 'None detected',
        '',
        'PROJECTS:',
        projectsArr.length ? projectsArr.map((t: string) => `- ${t}`).join('\n') : 'None detected',
        '',
        'FIELD CONFIDENCE:',
        JSON.stringify(fieldConfidence, null, 2),
        '',
        'MATCH CONTEXT:',
        JSON.stringify(matchInsights, null, 2),
        '',
        `QUESTION: ${question}`,
        '',
        'INSTRUCTIONS:',
        '- Answer naturally using the strongest available evidence from the structured data.',
        `- Tone: ${tone}.`,
        experienceWeak ? '- If experience is weak, use projects as primary evidence.' : '- Use experience when strong.',
        '- Always include at least one real project example if available; cite project title and one key technology.',
        '- When mentioning skills, explicitly map them to job requirements where possible.',
        '- Do NOT repeat the same skill multiple times.',
        '- Keep the answer concise (3–5 sentences).',
        '',
        'Answer:',
    ].join('\n');
}

/**
 * Convenience wrapper to call the LLM with the structured prompt.
 * `generateFn` must accept an array like [{ text: prompt }] and return a Promise<string>.
 */
export async function generateAnswerUsingLLM(
    question: string,
    structured: DashboardExtractionResult | any,
    generateFn: (contents: any[]) => Promise<string>
): Promise<string> {
    const prompt = buildAnswerPrompt(question, structured);
    // Collapse whitespace, trim and limit prompt length to avoid token overflow and latency spikes
    const finalPrompt = prompt.replace(/\s+/g, ' ').trim().slice(0, 4000);
    const response = await generateFn([{ text: finalPrompt }]);
    return response;
}

export default buildAnswerPrompt;
