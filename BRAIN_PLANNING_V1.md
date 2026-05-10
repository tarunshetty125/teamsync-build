# Brain Planning Layer V1

## 1. Current Limitation

Today, Brains influence five dimensions of the response:

| Dimension | Mechanism |
|---|---|
| Instructions | Domain-specific prompt fragments (`brain_directive`) |
| Emphasis | Context priority ordering via `ContextPriorityEngine` |
| Response style | STAR, first-person, technical, conversational |
| Response depth | Bullet range + word count from `ResponseStrategy` |
| Context priority | Source inclusion/exclusion + ordering |

**What is missing:**  Brains do not explicitly plan the **reasoning structure** of the answer.

Every Brain today emits the same instruction shape regardless of question variation within its category. A CodingBrain produces the same output contract for "What is a hashmap?" and "Optimize spiral matrix" — the only difference is depth scaling. The Brain has no awareness of *which reasoning steps* the answer should follow.

This means:

- A simple definition question gets the same "Approach → Edge Cases → Code → Complexity" skeleton as a deep optimization question.
- A system design question about "Explain Redis caching" gets the same "Requirements → High-Level Design → Deep Dive → Tradeoffs → Failure Handling" skeleton as "Design Instagram."
- Prompt shaping is one-size-fits-all within each domain.

## 2. Why Prompt Shaping Is Insufficient

Prompt shaping controls **how** to say something.

It does NOT control **what reasoning steps** to cover.

### Example: Prompt Shaping Only

```
"Focus on tradeoffs. Use 4-6 bullets. Keep under 500 words."
```

This tells the LLM the format, not the structure.

### Example: Reasoning Plan + Prompt Shaping

```
Plan:  [requirements, scale_estimation, architecture, tradeoffs, failure_handling]
Shape: "Use 4-6 bullets. Keep under 500 words."
```

Now the LLM knows the **order and coverage** of reasoning steps.

The plan acts as a table of contents for the answer. The prompt shaping acts as the formatting rules. Together they produce structurally correct, domain-appropriate responses.

## 3. How Planning Improves Answer Quality

| Without Planning | With Planning |
|---|---|
| "What is a hashmap?" → full algorithm skeleton | "What is a hashmap?" → `[quick_definition, example]` |
| "Optimize spiral matrix" → same skeleton | "Optimize spiral matrix" → `[algorithm, optimization, complexity_analysis, edge_cases]` |
| "Design Instagram" → generic depth-based template | "Design Instagram" → `[requirements, scale_estimation, architecture, database, cache, tradeoffs, failure_handling, summary]` |
| "Tell me about a challenge" → generic behavioral | "Tell me about a challenge" → `[star_situation, star_task, star_action, star_result]` |

Plans give Brains **question-aware structural guidance** without changing the generation pipeline.

## 4. Tradeoffs

| Benefit | Cost |
|---|---|
| Better answer structure | Additional rule evaluation per request |
| Question-specific reasoning steps | Maintenance of plan selection rules |
| Brains can adapt instructions based on plan | Slightly larger prompt surface area |
| Deterministic, testable, auditable | Plan rules may not cover all edge cases |
| No LLM calls, no async, no provider changes | Falls back safely to current behavior |

## 5. Latency Impact

The PlanningEngine is a **synchronous, rule-based classifier**. It:

- Reads `QuestionCategory`, `ResponseDepth`, matched signals from QuestionUnderstandingV2, and the question text
- Evaluates a fixed set of pattern rules (same approach as ResponseDepthEstimator)
- Produces a `ReasoningPlan` struct

**Expected overhead:** < 0.5ms on a modern desktop CPU.

No I/O. No provider calls. No allocations proportional to transcript length.

The existing pipeline budget of ~10ms for the full classification chain easily absorbs this.

## 6. Safe Integration Point

### Current flow

```
runAction()
→ QuestionUnderstandingV2      (category)
→ ResponseDepthEstimator       (depth)
→ Brain.execute()              (instructions)
→ ContextPriorityEngine        (context ordering)
→ PromptAssembler              (final prompt)
→ LLM
```

### New flow

```
runAction()
→ QuestionUnderstandingV2      (category)
→ ResponseDepthEstimator       (depth)
→ PlanningEngine.plan()        (reasoning plan)   ← NEW
→ Brain.execute(input)         (instructions, plan-aware)
→ ContextPriorityEngine        (context ordering)
→ PromptAssembler              (final prompt)
→ LLM
```

### What changes

1. `PlanningEngine.plan()` is called AFTER depth estimation, BEFORE Brain execution.
2. The `ReasoningPlan` is passed into `BrainInput` as an optional field.
3. Each Brain can read the plan to adjust its instructions.
4. If no plan is produced (unknown question, low confidence), the Brain falls back to its current behavior — **zero regression**.

### What does NOT change

- No streaming modifications
- No SessionTracker changes
- No request lifecycle changes
- No provider/LLM changes
- No ActionContextBuilder rewrite
- No ContextPriorityEngine changes
- No cancellation changes
- No deduplication changes
- No fallback behavior changes

## 7. Difference: Prompt Shaping vs Reasoning Plan

### Prompt shaping (current)

```
"Focus on tradeoffs and scalability. Use technical tone."
```

This is a **style directive**. The LLM decides what to cover.

### Reasoning plan (new)

```json
{
  "steps": ["requirements", "scale_estimation", "architecture", "tradeoffs"],
  "confidence": 0.88,
  "estimatedVerbosity": "deep"
}
```

This is a **structural directive**. The Brain tells the LLM what sections to cover and in what order. The LLM still generates the content, but the skeleton is predetermined.

The plan does NOT generate answers. It guides response structure.
