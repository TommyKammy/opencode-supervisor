# Issue #25: CI: treat cancelled checks as non-failing concurrency signals

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/opencode-supervisor/issues/25
- Branch: codex/issue-25
- Workspace: /tmp/codex-supervisor-opencode-workspaces/issue-25
- Journal: /tmp/codex-supervisor-opencode-workspaces/issue-25/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8867f379bba9aaf7ae0d9a652a4a09335467b1ca
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-12T10:36:42.655Z

## Latest Codex Summary
- Added focused coverage for cancelled CI checks and fixed supervisor check classification so cancelled-only runs no longer infer `repairing_ci` or generate failing-check failure context.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: GitHub concurrency cancellations are normalized as `cancel`, but `summarizeChecks()` and `buildChecksFailureContext()` were still treating `cancel` as a true failure.
- Primary failure or risk: Cancelled-only check sets incorrectly set `hasFailing=true`, produced failing-check signatures including cancelled runs, and inferred `repairing_ci`.
- Last focused command: `npm test`
- Files changed: `src/core/supervisor.ts`, `test/check-cancellation.test.ts`
- Next 1-3 actions: review diff for minimality; commit verified checkpoint; hand back with reproducing evidence and verification results.

### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproduced with `npm test -- test/check-cancellation.test.ts` before fix; failing assertions showed `hasFailing=true` for cancelled-only checks, failure-context signature `build:cancel|lint:fail`, and inferred state `repairing_ci`.
- Verified fix with `npx tsx --test test/check-cancellation.test.ts` and `npm test` (both passing on 2026-03-12).
