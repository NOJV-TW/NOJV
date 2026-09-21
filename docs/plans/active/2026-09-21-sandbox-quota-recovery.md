# Sandbox quota recovery

**Goal:** Capacity contention must delay judging instead of producing SE, while invalid sandbox configuration still fails promptly.

**Architecture:** Keep Kubernetes admission as the shared capacity authority. Observe short contention through the existing Job/Pod watches; return persistent capacity pressure to a durable Temporal timer, releasing the worker activity slot. Preserve the ordinary bounded infrastructure retry policy and submission/rejudge ownership.

**Tech stack:** Kubernetes Jobs/ResourceQuota, Temporal TypeScript SDK, Vitest.

## Evidence and constraints

- Production v1.1.21: 787 quota-related SE submissions, 70 users, 3 problems, 1 exam; created 2026-09-21 10:32–11:12 Asia/Taipei.
- Each 20-case wave requests 2 CPU; namespace quota is 4 CPU; worker activity concurrency is 4.
- `isDeterministicAdmissionFailure` matches `forbidden` in a normal `exceeded quota` rejection. Sandbox activity retries three times, then persists SE.
- A later sandbox stuck terminating is a separate runtime incident; no force deletion or node restart is part of the code fix.
- No schema changes, new scheduler, raised quotas, or unbounded generic infrastructure retries.
- References: [Judge pipeline](../../architecture/JUDGE_PIPELINE.md), [Reliability](../../operations/RELIABILITY.md), [Testing](../../runbooks/testing.md), [Kubernetes quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/).

## Implementation and verification

1. Add executor regressions for the exact quota message, capacity recovery, quota remaining unavailable, deadline before Pod creation, cancellation, and real admission rejection. Run before/after the fix.
2. Classify quota pressure before generic forbidden errors. Preserve waiting and return persistent pressure as `SandboxBackpressureError`.
3. Handle capacity pressure with cancellable durable workflow backoff. Correct the sandbox admission non-retryable policy; retain three attempts for other failures. Test more than three pressure cycles, cancellation/rejudge restore, and permanent/generic failures with Temporal's test server.
4. Add and run a real Kubernetes ResourceQuota contention/release regression in the isolated local k3d test namespace, including cleanup evidence.
5. Run worker regression tests, relevant integration tests, typechecking, lint, formatting, and repository verification. Inspect the final diff and update living docs.
6. Prepare a reviewable PR. Production rollout requires exact release identity, healthy workers, sustained quota-pressure recovery without new quota SE, and evidence that the stuck sandbox is resolved. Rejudge only the identified affected records after recovery, through the normal audited workflow; verify new verdicts and scores separately.

## Verification results (2026-09-21)

- Reproduced the production quota rejection in failing regression tests before fixing it. Covered direct API quota rejection for sandbox resources, controller `FailedCreate` events, persistent contention, cancellation, and cleanup failure.
- `pnpm ci:verify` passed: formatting, repository guards, builds, typechecking, lint, 3,234 unit tests, and 61 component tests.
- Temporal integration suite: 12 tests passed, including recovery after more than three capacity failures, cancellation during a capacity wait, permanent admission failure, and replay of a pre-fix workflow history. The sanitized replay fixture was generated from commit `507f1542` with the Temporal test server. These tests use no database; the targeted run omitted the unrelated destructive database setup.
- Real local Kubernetes suite: 15 tests passed, including four concurrent submissions blocked by an occupied ResourceQuota and a sustained quota rejection that crosses the executor/Temporal boundary, cleans up, waits, and succeeds on a fresh attempt. Only the cluster's standard root CA ConfigMap remained after the suite.
- The local cluster uses k3s, not production's sandbox runtime and network configuration. This verifies executor behavior under real Kubernetes admission, not production isolation or live recovery.
- Independent review findings on workflow replay, cleanup failures, and Advanced sidecar quota handling were fixed; final review reported no blocking findings.
- At 11:39 Asia/Taipei, a read-only production query still identified 787 affected submissions. A local restricted inventory records submission IDs and generations for later revalidation; no user code or credentials are included.

## Remaining rollout gates

- Review and ship the repair; verify the deployed worker image digest and source revision.
- Verify runtime health, resource cleanup, and capacity recovery under production traffic for at least 15 minutes, with no new quota-related SE. Follow the quota scenario in the incident recovery runbook.
- Revalidate the affected-submission inventory before any audited rejudge; verify resulting verdicts and scores separately.
- Production mitigation, release, and affected-submission rejudge have not been performed. Keep this plan active until the rollout gates are satisfied.
