# Judge admission and memory boundary

Status: in progress
Branch: `fix/k8s-memory-admission`

## Problem

The problem editor permits up to 1024 MB, while production's sandbox
`LimitRange` permits only 1 Gi. The worker adds 64 MB of cgroup headroom, so a
valid 1024 MB problem is submitted with a 1088 Mi container limit and is
rejected by Kubernetes. The Job controller records that rejection as an Event,
not as a Job condition. The worker misses the Event, waits for the full Job
deadline, and Temporal retries the same deterministic failure, occupying all
judge activity slots.

## Design

- Set the sandbox container ceiling to 1536 Mi as a platform safety margin.
  Keep the per-problem limit at 1024 MB; its normal container limit remains
  1088 Mi with the existing 64 MB measurement headroom. Do not increase
  authoring limits or node-wide capacity for this bug.
- Make the worker inspect Job warning Events when a Job has no started Pod.
  Detect `FailedCreate` admission errors, including LimitRange and forbidden
  resource messages, before the normal deadline.
- Treat deterministic admission failures as a terminal
  `SandboxAdmissionError`, so the submission becomes `system_error` without a
  Temporal retry. Keep capacity/scheduling backpressure retryable.
- Keep the existing worker concurrency and sandbox quota. They are not the
  bottleneck once a Job that cannot be admitted releases its activity slot
  promptly.
- Refresh the exact Python and OpenJDK APK pins to the versions currently
  available in the pinned Alpine repository and keep the deployment toolchain
  table in sync.

## Verification

- Unit test the memory ceiling and FailedCreate Event path.
- Run focused worker/core tests, lint, typecheck, format, doc-drift, and Helm
  render/lint checks.
- Push the combined branch as PR352 and verify the fresh GitHub Actions run.
