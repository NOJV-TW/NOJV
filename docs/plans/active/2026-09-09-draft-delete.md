# Draft deletion after reference verification

Production v1.1.1 (`358daeb1`) retains a draft with one accepted practice reference submission and no course or activity links. Its deletion guard rejects every submission, including authoring verification, while both UI entry points interpret HTTP 200 form-action failures as success.

- [x] Verify production revision and inspect draft relationships read-only.
- [x] Reproduce deletion against current main with a real test database.
- [x] Allow completed practice reference submissions to be removed with an unused draft; enqueue source and verdict storage cleanup atomically. Preserve ordinary submissions, active judging, activity links and audit history.
- [x] Use the existing DELETE API in both UI entry points and verify list removal plus actionable failure messages.
- [x] Run regression checks and prepare an isolated reviewable change.

References: [Problem permissions](2026-09-08-problem-permissions.md), [Testing](../../runbooks/testing.md). No production data is deleted during investigation.

Validation: the reference-only reproduction failed before the backend fix; a deterministic concurrent rejudge test failed before submission-row locking. Both now pass. Full `pnpm ci:verify` passed. Targeted integration: 10 tests; browser flows: 4 tests; targeted unit tests: 54 tests. Independent review found the locking race and confirmed the subsequent correction. Production rollout remains pending.
