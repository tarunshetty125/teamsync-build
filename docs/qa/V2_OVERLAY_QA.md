# V2 Overlay — Production QA Script

Run with **pro-v2 overlay** enabled. Use **Technical Interview** mode template unless noted.

## Prerequisites

- Dev build: `npm run app:dev`
- Open DevTools on overlay window (optional): log `[V2]` / watch `recommendedButton` in React DevTools
- Two distinguishable meetings (or start/stop twice with different spoken content)

---

## 1. Session ID on cold start

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Launch app, open overlay **without** starting a meeting | No transcript bleed; no errors |
| 1.2 | In DevTools: `await window.electronAPI.getSessionId()` | Returns `{ sessionId: "<non-empty>" }` |
| 1.3 | Start Meeting A | Overlay resets; new session id in `session-reset` payload |

**Pass:** Session guards active before first meeting (no stale IPC applied to UI).

---

## 2. Meeting A → B → A (session isolation)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | **Meeting A:** Start meeting, speak: *"Tell me about a time you led a project"* | Transcript shows A; behavioral-style actions |
| 2.2 | Run **Suggest** (what_to_answer), wait for stream to finish | Response belongs to A only |
| 2.3 | **End meeting** (or Stop), then **Start Meeting B** immediately | Messages cleared; transcript empty; no A text in summary |
| 2.4 | **Meeting B:** Speak: *"Implement binary search on a sorted array"* | Transcript B only; coding actions (Hint, Optimal, Complexity, Edge) |
| 2.5 | **Without ending**, verify Meeting A text never appears in transcript or response | **Critical pass** |
| 2.6 | End B, start **Meeting A2** (third session) | Clean slate again |

**Fail signals:** Old transcript dots, old response text updating, wrong question in Suggest.

---

## 3. Overlapping requests (lifecycle)

Perform during **one active meeting**:

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Click **Suggest** | Stream starts in right panel |
| 3.2 | While streaming, click **Clarify** | Suggest stops; Clarify stream only (no mixed tokens) |
| 3.3 | While streaming, submit **manual chat** | Prior stream cancelled; manual response only |
| 3.4 | While streaming, **Screen scan** | Prior cancelled; scan result only |
| 3.5 | Rapid-fire: Suggest → manual → Screen scan | Last action wins; no crash; `isProcessing` clears after each |

**Pass:** No cross-stream text in a single bubble; no permanent loading state.

---

## 4. RAG / cancel parity

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Start Suggest, switch to Recap mid-stream | Recap content only; no late Suggest tokens |
| 4.2 | Click **Reset** (not processing) | All UI cleared |
| 4.3 | Start meeting again | Fresh session; no ghost state |

---

## 5. Recommended button follows detection

Use **Technical Interview** template.

| Spoken phrase (interviewer) | Expected action set | Highlighted row (recommended) |
|----------------------------|---------------------|-------------------------------|
| *"Design a URL shortener at scale"* | System design (Tradeoffs, Clarify, Approaches, Deep dive) | **Tradeoffs** (or rule match) |
| *"Write a function for two sum"* | Tech: Hint, Optimal, Complexity, Edge | **Optimal solution** default |
| *"What is the time complexity of your approach?"* | Same tech set | **Complexity** |
| *"Tell me about yourself"* | Suggest, Clarify, Recap/Brainstorm, Follow up | **Suggest** or **Answer now** rule |

**Visual check:** `v2-action-row--recommended` class on exactly one visible action.

**Fail:** Stays on Suggest while coding buttons are shown; recommended id not in `activeQuickActions` list.

---

## 6. Transcript UI structure

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Expand overlay, open Live insights | Order: Summary → Actions → (toggle) Transcript |
| 6.2 | **Show transcript** | Collapsible block below actions; scrollable; live updates |
| 6.3 | Hide transcript | Section collapses smoothly |

---

## 7. Screen scan mode

| Session / detection | Expected scan mode |
|--------------------|--------------------|
| General / behavioral | `interview_question` |
| Coding detected | `coding` |
| General template + ambiguous | `ui_general` |

Verify via logs in main process or response style (coding vs product UI).

---

## 8. Resize stability

| Step | Action | Expected |
|------|--------|----------|
| 8.1 | Run Suggest with long streaming answer | Window does **not** jitter every token |
| 8.2 | Stream completes | Window settles (one resize burst) |
| 8.3 | Toggle transcript | Single smooth height change |

---

## Sign-off

| Area | Pass / Fail | Notes |
|------|-------------|-------|
| Session ID mount | | |
| A → B isolation | | |
| Overlap cancel | | |
| Detection → buttons | | |
| Transcript layout | | |
| Resize | | |

**Reviewer:** _______________ **Date:** _______________
