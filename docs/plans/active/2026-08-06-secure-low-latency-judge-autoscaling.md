# Secure Low-Latency Judge and Autoscaling

## Goal

Reduce the warm-node latency of a normal 20-case submission from the current
37–49 seconds to a median of at most 10 seconds and p95 of at most 15 seconds,
without weakening testcase isolation or the existing Temporal recovery model.

Production judging is fail-closed: untrusted code must not run unless gVisor,
the deny-all sandbox NetworkPolicy, resource limits, and the runtime probe are
all effective.

## Design

- Standard and checker run phases execute at most 20 testcase containers in one
  Kubernetes Job. Materialization and compilation run once per wave; each case
  keeps its own container, cgroup, scratch mounts, and read-only artifact mount.
- Larger submissions remain chunked in waves of 20 to cap Pod size. Interactive
  and advanced judging retain their existing execution model.
- Compile/materialize containers keep the existing 500m CPU request. Per-case
  containers request 100m CPU. Memory requests and all limits remain unchanged.
- Every production sandbox Pod explicitly requests the `gvisor` RuntimeClass.
  Worker startup verifies the RuntimeClass, runs a hardened smoke Pod, and then
  runs the existing NetworkPolicy enforcement probe. Any unverified condition
  prevents the judge worker from starting.
- Node eviction, shutdown, loss, and Spot reclamation are retryable sandbox
  infrastructure failures. Temporal retries them in a fresh ephemeral sandbox;
  contestant OOM, timeout, and runtime failures remain verdicts.

## Capacity

### Single-machine k3s

- Sandbox quota: 4 Pods, 4 requested CPU, 12Gi requested memory.
- One 20-case Job requests approximately 2 CPU and 5Gi, so at most two normal
  submissions execute concurrently and excess work remains Pending.
- Web HPA: 1–3 replicas at 70% CPU.
- Judge worker: one replica with concurrency 4. The sandbox quota, not worker
  polling capacity, is the physical ceiling.
- k3s uses pinned gVisor `runsc` with a containerd v3 runtime handler and keeps
  `pod-max-pids=256`.

### GKE

- `pool-sandbox`: one on-demand `e2-standard-4` node, total min/max 1.
- `pool-sandbox-spot`: Spot `e2-standard-4`, total min 0 and total max 4.
- Both pools use COS_CONTAINERD, gVisor, image streaming, the sandbox label and
  taint, and a Pod PID ceiling of 1024.
- Sandbox quota: 10 Pods, 10 requested CPU, 30Gi requested memory.
- Web HPA remains 2–15; two judge workers at concurrency 5 can dispatch every
  slot in the ten-Pod sandbox quota while the five sandbox nodes remain the
  full 20-case execution ceiling. The unused Prometheus/KEDA placeholder is
  removed.

## Verification and rollout

- Unit tests cover 20/21-case wave boundaries, manifest requests, payload
  secrecy, runtime hardening, and retryable disruption classification.
- Helm tests render single-machine, GKE, and release-maintenance paths. GKE
  script tests require pool-wide total bounds, gVisor, Spot, PID limits, and
  image streaming.
- Security validation covers egress and metadata denial, token absence, fork
  and memory bombs, timeout, scratch isolation, and gVisor runtime verification.
- Performance validation repeats a fixed 20-case submission on warm k3s and GKE
  nodes and records scheduling, image, materialize, compile, run, log, and
  cleanup timings.
- Merge only after `pnpm ci:verify`, submission E2E, and Kubernetes sandbox
  checks pass. Install and verify gVisor in staging before the production k3s
  maintenance window. Tag only the merged commit, then deploy through the
  existing release and Flux path.

## Acceptance

- A committed submission is never lost across worker, node, or Spot failures.
- At most one Temporal judge workflow is active per submission.
- Production refuses judging if gVisor or NetworkPolicy enforcement is absent.
- A normal 20-case submission uses one Pod wave and one compilation.
- Warm-node submission-to-verdict median is at most 10 seconds and p95 at most
  15 seconds, with at least a 60% reduction from the measured baseline.
- No application queue, database migration, or public API change is introduced.
