# Follow-Up Ticket: Mode Detection Hardening

## Summary

Harden the Pro V2 intent reducer transition from coding to system design to behavioral.

## Failing Scenario

Test:

```txt
electron/tests/v2-overlay-recommendation.test.ts
intent reducer switches rapidly coding to system design to behavioral
```

Current result:

```txt
expected: behavioral
actual: general
```

## Scope

Treat this as a separate mode-detection hardening task. Do not couple it to Pro Overlay V2 Action Context Hardening.

## Acceptance Criteria

- The reducer correctly classifies the rapid transition:

```txt
coding -> system_design -> behavioral
```

- Existing coding and system-design detection coverage remains green.
- No changes to action context routing, response ownership, or quick-action contracts are required for this ticket.
