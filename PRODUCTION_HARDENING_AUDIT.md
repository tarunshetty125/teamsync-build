# Production Hardening Audit

## Audit Date: 2026-05-10

## Scope

Full audit of the `electron/intelligence/` module and its integration
surface with `IntelligenceEngine`, `ActionContextBuilder`, and `ActionOutputValidator`.

---

## Findings

### 🔴 CRITICAL

#### C1. BrainRegistry.register() allows silent overwrites

**File:** `electron/intelligence/brains/BrainRegistry.ts:28-33`

**Issue:** `register()` does NOT throw on duplicate IDs — it logs a warning and overwrites.
The JSDoc says `@throws if a brain with the same ID is already registered` but the code
only warns. This is a doc/behavior mismatch that could mask bugs if two brains
accidentally share an ID.

**Fix:** Align doc with behavior. The warn-and-overwrite pattern is actually safer for
hot-reload scenarios, so update the JSDoc to match.

**Risk:** Low — defensive behavior is correct, doc is wrong.

---

### 🟠 HIGH

#### H1. `planContainsAny` import unused in SystemDesignBrain

**File:** `electron/intelligence/brains/SystemDesignBrain.ts:8`

**Issue:** `planContainsAny` is imported but never used in the current SystemDesignBrain
implementation. Only `planContains` and `isPlanConfident` are called.

**Fix:** Remove unused import.

**Risk:** None — dead import.

#### H2. MetricCollector uses `Array.slice()` for circular buffer eviction

**File:** `electron/intelligence/metrics.ts:89-91, 95-98`

**Issue:** `this.brainMetrics.slice(-this.maxEntries)` allocates a new array on every
eviction. With maxEntries=500, this is fine in practice, but the pattern could be
replaced with a proper circular buffer (index wrap) for zero-allocation eviction.

**Fix:** Not urgent — current approach is correct and performant for 500 entries.
Consider replacing if metric volume increases significantly.

**Risk:** Low — memory allocation is bounded.

#### H3. ScreenAnalysisBrain not plan-aware

**File:** `electron/intelligence/brains/ScreenAnalysisBrain.ts`

**Issue:** ScreenAnalysisBrain is the only Brain that does not consume `reasoningPlan`.
This is intentional (screen scan has its own specialized pipeline), but should be
documented explicitly.

**Fix:** Add a comment explaining the intentional exclusion.

**Risk:** None — documented intentional behavior.

#### H4. Duplicate `normalizeQuestion` function across 3 files

**Files:**
- `QuestionUnderstandingV2.ts:62-69`
- `ResponseDepthEstimator.ts:38-45`
- `ContextPriorityEngine.ts:117-124`

**Issue:** Three nearly identical `normalizeQuestion()` functions with trivial regex
differences. This is technical debt from incremental module development.

**Fix:** Extract to a shared utility in `electron/intelligence/utils.ts`.

**Risk:** Low — functional behavior is identical; extraction is safe.

---

### 🟡 MEDIUM

#### M1. `adapters.ts:13` — redundant import

**File:** `electron/intelligence/adapters.ts:13`

**Issue:** `ResponseDepth` is imported separately from `./types` when it's already
available from the destructured import on line 12. Duplicate import statement.

**Fix:** Merge into single import.

**Risk:** None.

#### M2. `ContextBundle.ts` comment references `ReasoningPlanner`

**File:** `electron/intelligence/ContextBundle.ts:3`

**Issue:** Comment says "Consumed by: ReasoningPlanner" but no `ReasoningPlanner` class
exists. This is a stale reference from the architecture design phase.

**Fix:** Update comment to reference `PlanningEngine` and `Brain.execute()`.

**Risk:** None — comment only.

#### M3. `metrics.ts` — PipelineLatencyMetric missing `planningMs` field

**File:** `electron/intelligence/metrics.ts:41-68`

**Issue:** `PipelineLatencyMetric` tracks `brainMs` and `budgetEnforceMs` but has no
field for `planningMs` now that the PlanningEngine exists. When planning is wired into
the pipeline, latency should be tracked separately.

**Fix:** Add optional `planningMs` field.

**Risk:** None — additive, backward-compatible.

#### M4. `QUALITY_RULES` coding.approach_missing rule too aggressive

**File:** `electron/intelligence/evaluation/QualityRules.ts`

**Issue:** The `coding.approach_missing` rule triggers for ALL coding responses
regardless of depth. A short "What is a hashmap?" answer shouldn't require naming an
"approach." The rule should have `minDepth: 'medium'`.

**Fix:** Add `minDepth: 'medium'` to the rule.

**Risk:** Low — reduces false positives.

---

### 🟢 LOW

#### L1. `createBrainLayer.ts` logs at boot time with `console.log`

**File:** `electron/intelligence/brains/createBrainLayer.ts:45`

**Issue:** Calls `console.log(registry.getSummary())` unconditionally at boot.
This is fine for development but should be gated behind a verbose flag in production.

**Fix:** Guard with `process.env.NODE_ENV !== 'production'` or a verbose flag.

#### L2. BrainSelector logs every selection with `console.log`

**File:** `electron/intelligence/brains/BrainSelector.ts:80, 92, 100, 105`

**Issue:** Every brain selection is logged via `console.log`. In production with high
request volume, this creates noise. Should use the MetricCollector instead.

**Fix:** Replace with metric recording or conditional verbose logging.

#### L3. `QuestionAnalysis.ts:3` references `ReasoningPlanner` in comment

**File:** `electron/intelligence/QuestionAnalysis.ts:3`

**Issue:** Comment says "Consumed by: ReasoningPlanner" — stale reference.

**Fix:** Update to reference `PlanningEngine`.

---

## Applied Fixes

The following low-risk fixes are applied in this audit pass:

1. ✅ H1 — Remove unused `planContainsAny` import from SystemDesignBrain
2. ✅ H3 — Add comment to ScreenAnalysisBrain explaining plan exclusion
3. ✅ M1 — Fix duplicate import in adapters.ts
4. ✅ M2 — Update stale ReasoningPlanner comment in ContextBundle.ts
5. ✅ M3 — Add optional `planningMs` to PipelineLatencyMetric
6. ✅ M4 — Add `minDepth: 'medium'` to coding.approach_missing rule
7. ✅ L3 — Update stale comment in QuestionAnalysis.ts
8. ✅ C1 — Fix JSDoc/behavior mismatch in BrainRegistry.register()
