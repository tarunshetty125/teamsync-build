# Question Understanding V2

## Current Behavior

### Current classification path

For Brain routing in `runAction()` today, the path is:

1. `IntelligenceEngine.runAction()`
2. `buildContext()` in `ActionContextBuilder`
3. `IntelligenceEngine.buildBrainAnalysis()`
4. `BrainSelector.select()`

The key routing inputs currently come from:

- `ActionContextBuilder.getQuestionResponseProfile()`
  - regex-style question profiling for `coding`, `system_design`, `resume_or_jd`, `follow_up`, `fresh_general`, `general`
- `IntelligenceEngine.buildBrainAnalysis()`
  - derives a `QuestionAnalysis`
  - uses `sessionMode` heavily
  - falls back to `getQuestionResponseProfile()` for general mode
- `BrainSelector`
  - maps `QuestionCategory` to the Brain instance
  - uses explicit `screen_scan` override

`IntentClassifier.ts` is important elsewhere, but it is not the primary classifier for Brain routing in the `runAction()` path. It mainly supports `runWhatShouldISay()`.

### Current weaknesses

- Exact-phrase dependence:
  - `getQuestionResponseProfile()` is mostly direct regex matching.
  - Semantically related wording can miss when it does not include the exact tracked phrase family.
- Session-mode bias:
  - `buildBrainAnalysis()` preserves explicit mode strongly, which is correct for user override, but general-mode routing still depends on the legacy heuristic bucket.
- Weak resume/project grounding:
  - `tell me about your project` does not reliably hit the resume/JD bucket.
- Weak product-style system-design prompts:
  - `design whatsapp` can miss because the legacy pattern looks for `design a|an|the` or other explicit architecture words.
- Weak algorithmic optimization phrasing:
  - `optimize spiral matrix` can miss because the old heuristic expects more implementation-specific keywords.

## Failure Cases

Examples that are currently at risk:

- `optimize spiral matrix`
  - desired: `coding`
  - risk: falls back to `general`
- `design whatsapp`
  - desired: `system_design`
  - risk: falls back to `general`
- `tell me about your project`
  - desired: `resume_jd`
  - risk: falls back to `general`

## Proposed Safe Improvements

### V2 design

Introduce a deterministic classifier for Brain routing:

Question
↓
Fast normalization
↓
Weighted semantic signals
↓
Category score matrix
↓
Confidence + fallback decision
↓
QuestionCategory

### Safety model

- No LLM calls
- No new dependencies
- No async work
- No streaming changes
- No change to request lifecycle
- No change to `BrainSelector`
- Existing legacy question profile remains the fallback

### Scoring strategy

Use weighted signal families for:

- `coding`
  - optimization, bug/fix/debug, algorithm/data-structure terms, complexity/runtime terms
- `system_design`
  - design/scale/distributed/system terms, product-name routing, infra terms
- `behavioral`
  - STAR-style prompts, challenge/failure/conflict/leadership phrasing
- `resume_jd`
  - project/resume/background/experience/tech-stack phrasing

Rules:

- strong multi-word phrases get higher weight
- supporting aliases add smaller weight
- highest score wins only if confidence is strong enough
- weak or ambiguous cases fall back to the current legacy profile behavior

### Confidence policy

V2 should return:

```ts
{
  category,
  confidence,
  matchedSignals,
  fallbackUsed
}
```

Decision rule:

- high top score + sufficient margin over second place
  - use V2 category
- low score or weak separation
  - use legacy `getQuestionResponseProfile()` result instead

This keeps V2 additive rather than disruptive.

## Latency Considerations

Target:

- under 10ms per classification

Expected actual cost:

- simple lowercase normalization
- a bounded set of regex/phrase checks
- no allocations proportional to transcript length
- no I/O or provider calls

Given the small fixed rule set, expected overhead is typically well under 1ms for a single question on a modern desktop CPU, with ample room under the realtime budget.

## Integration Plan

Safe integration point:

- keep `runAction() -> buildContext() -> BrainSelector`
- improve only `IntelligenceEngine.buildBrainAnalysis()`

Mechanically:

1. add `QuestionUnderstandingV2` module
2. compute semantic score result from question + mode + intent
3. fall back to existing profile heuristic if confidence is low
4. preserve screen-scan override in `BrainSelector`
5. expand tests around category derivation, confidence, and fallback
