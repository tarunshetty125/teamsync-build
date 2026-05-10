# Resume × JD Intelligence V2

## 1. Problem

Current state: profile intelligence is a single blob of context.

The system does not distinguish between:
- Resume facts (projects, roles, skills)
- JD requirements (role, stack, responsibilities)
- Fit reasoning (where resume aligns with JD)
- Gap reasoning (where resume falls short)

When a question like "Why are you a good fit?" arrives, the Brain treats
all profile context equally — no structured alignment happens.

## 2. Goal

Split profile intelligence into structured dimensions:

- `resume_context` — extracted projects, roles, skills, metrics
- `jd_context` — extracted requirements, stack, responsibilities
- `fit_signals` — where resume aligns with JD
- `gap_signals` — where resume falls short
- `suggested_emphasis` — which projects/skills to lead with

## 3. Design

### Input

```ts
{
  question: string;
  category: QuestionCategory;
  resumeText?: string;
  jdText?: string;
  brainId: BrainId;
}
```

### Output

```ts
{
  strongest_matches: FitSignal[];
  missing_skills: string[];
  suggested_emphasis: string[];
  recommended_projects: string[];
  fit_reasoning: string;
  confidence: number;
}
```

## 4. Integration

The ResumeJDAnalyzer runs deterministically on the existing
profile/JD context. It does NOT:

- Fetch new data
- Call the LLM
- Create a new database
- Rewrite retrieval

It adds structured reasoning ON TOP of existing context.

## 5. Latency

Expected: < 1ms (regex + keyword extraction on bounded input text).
