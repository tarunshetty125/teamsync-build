# Adaptive Response Depth V1

## Current Limitations

Today response depth is mostly an indirect effect of prompt wording plus coarse brain behavior.

Current issues:

- depth is not estimated explicitly from question complexity
- similar questions can get inconsistent answer length
- simple definition questions can receive overly long answers
- open-ended system design questions are not always pushed deep enough
- coding questions do not consistently distinguish quick fixes from more involved optimization/debug reasoning

## Proposed Approach

Add a deterministic `ResponseDepthEstimator` between Question Understanding V2 and Brain execution:

Question
↓
QuestionUnderstandingV2
↓
ResponseDepthEstimator
↓
Brain Selection
↓
Response Strategy
↓
LLM generation

The estimator is:

- synchronous
- deterministic
- regex/phrase-score based
- realtime-safe
- fallback-friendly

No provider calls and no async work are introduced.

## Depth Levels

### short

Use for:

- direct definitions
- simple “what is X?” prompts
- quick clarifications
- low-complexity general questions

Expected behavior:

- concise answer
- 1 to 3 bullets max when bullets help
- minimal extra explanation

### medium

Use for:

- explanations
- comparisons
- moderate coding questions
- behavioral answers
- resume/JD prompts

Expected behavior:

- direct answer plus explanation
- moderate structure
- one level of supporting detail

### deep

Use for:

- system design
- architecture
- scalability
- tradeoff-heavy prompts
- open-ended “how would you design...” prompts
- complex coding/debug/optimization prompts when multiple reasoning layers are needed

Expected behavior:

- structured sections
- tradeoffs and edge cases
- multiple supporting points

## Tradeoffs

Benefits:

- better alignment between question complexity and answer verbosity
- more consistent outputs across similar prompts
- no runtime dependency on LLM classification

Costs:

- depth is still heuristic, not semantic understanding in the full ML sense
- a fixed scoring matrix will need occasional tuning for new phrasing

## Latency Impact

The estimator uses:

- lightweight normalization
- a bounded set of regex checks
- a few score comparisons

Expected overhead is well below 1ms per classification on desktop hardware.

## Integration Point

Safe integration point:

- keep `runAction() -> buildContext() -> BrainSelector -> Brain.execute()`
- improve only the response strategy calculation inside the Brain Layer integration path

This preserves:

- streaming
- cancellation
- SessionTracker
- deduplication
- fallback behavior
- request lifecycle
