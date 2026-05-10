## Context Priority V1

### Current limitations

Today the Brain Layer receives context, but prompt assembly still treats most context sections uniformly. In the live `runAction()` path, `serializePromptObject()` uses a fixed context order:

1. `rag`
2. `supplemental`
3. `profile`
4. `transcript`

That fixed order ignores the actual question type. A coding question can see stale RAG before the transcript. A resume question can place profile intelligence after generic supplemental text. A screen-heavy question can carry OCR data, but the prompt does not explicitly elevate it.

### Why irrelevant context hurts quality

Irrelevant context increases answer drift:

- it raises the chance that the model anchors on stale or off-topic details
- it weakens the strongest signal for the current question
- it wastes token budget on sources that should be background-only
- it increases contamination risk for coding and system-design answers

For this pipeline, the goal is not more context. The goal is the right context first.

### Proposed prioritization

Context Priority Engine V1 is a deterministic scoring layer that runs after:

1. `QuestionUnderstandingV2`
2. `ResponseDepthEstimator`
3. `BrainSelector`

It assigns one priority level to each abstract source:

- `critical`
- `high`
- `medium`
- `low`
- `ignore`

The engine is driven by:

- `question`
- `questionCategory`
- `responseDepth`
- `brainId`
- `intent`
- `sessionMode`
- `screen presence`

The output is:

```ts
{
  priorities,
  excludedSources,
  reasoning,
  confidence
}
```

### Safe integration point

This is integrated in the existing path only:

`runAction() -> buildContext() -> Brain -> ContextPriorityEngine -> prompt assembly`

No streaming, cancellation, or request lifecycle code is changed.

### Prompt effects

V1 influences the live prompt in three small ways:

1. It sets an optional prompt context order for the existing prompt object.
2. It can safely exclude `rag` when the engine marks it `ignore`.
3. It injects a deterministic context-priority instruction and allows brains to sharpen their own context guidance.

### Tradeoffs

- We keep the current `ActionContextBuilder` shape, so some abstract sources map onto the same concrete prompt section.
- `resume` and `jd` both currently map to `profile`.
- `screen`, `previous_response`, `session_history`, and generic `supplemental` currently map through `supplemental` or transcript-driven context.
- This is intentionally conservative to avoid architecture churn.

### Latency impact

V1 uses only local string normalization, regex checks, and fixed scoring tables.

- No LLM calls
- No provider calls
- No async logic
- No new dependencies

Expected runtime overhead is well below `1ms` per request on normal desktop hardware.
