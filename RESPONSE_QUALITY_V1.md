# Response Quality Evaluator V1

## 1. Problem

The existing `ActionOutputValidator` validates **format** (bullets, questions, structure).

It does NOT validate **domain quality**:

| Brain | Missing quality signal |
|---|---|
| CodingBrain | Complexity analysis absent, no edge cases |
| BehavioralBrain | Not STAR-structured, missing first-person voice |
| SystemDesignBrain | No tradeoffs, missing scalability reasoning |
| ResumeBrain | Not grounded in profile/JD |
| GeneralBrain | Verbose or unfocused answer |

The ReasoningPlan tells us WHAT the answer should cover.
The ResponseQualityEvaluator checks WHETHER it did.

## 2. Design

### Input

```ts
{
  question: string;
  category: QuestionCategory;
  brainId: BrainId;
  responseDepth: ResponseDepth;
  reasoningPlan?: ReasoningPlan;
  generatedResponse: string;
}
```

### Output

```ts
{
  score: number;        // 0–1 composite quality score
  issues: QualityIssue[];
  suggestions: string[];
  confidence: number;   // confidence in the evaluation itself
}
```

## 3. Integration Strategy

The evaluator runs AFTER the full response is available.

It does NOT block streaming — it evaluates the collected response.

It can:
- Log quality metrics
- Inject a tiny deterministic reminder instruction for future requests
- Flag low-quality responses in metrics

It does NOT:
- Regenerate answers
- Delay streaming
- Call the LLM
- Modify the response

## 4. Tradeoffs

| Benefit | Cost |
|---|---|
| Catches missing domain signals | Additional regex evaluation after response |
| Drives quality metrics | Rules may produce false positives on edge cases |
| Plans + evaluation = closed feedback loop | Maintenance of domain-specific rules |
| Deterministic, testable | Cannot catch semantic quality issues |

## 5. Latency

The evaluator is synchronous regex/pattern matching on the generated response.

Expected overhead: < 1ms per evaluation.

No I/O. No provider calls. No second LLM pass.
