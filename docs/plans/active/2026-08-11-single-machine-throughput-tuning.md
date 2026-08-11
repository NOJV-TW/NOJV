# Single-Machine Judge Throughput Tuning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Find and deploy the highest sustainable judging throughput on the current 8-vCPU single machine without losing submissions or violating isolation and reliability limits.

**Architecture:** Use a temporary benchmark user and API token to submit a fixed public 20-case workload through the real HTTP, storage, Temporal, worker, and Kubernetes path. Test one reversible configuration at a time, keep resource limits and gVisor unchanged, and accept a profile only when throughput rises without errors, stuck work, node pressure, or material p95 regression.

**Tech Stack:** SvelteKit HTTP API, PostgreSQL, Redis, Temporal, k3s, Helm/Flux, Bash, Node.js.

---

### Task 1: Create an isolated benchmark identity and workload

1. Select an existing published 20-case practice problem with a known accepted source.
2. Create one temporary user and short-lived token with only `submissions:write` and `submissions:read`.
3. Confirm one submission reaches a terminal accepted verdict through the public API.
4. Record every benchmark submission ID for cleanup; do not use contest, assignment, exam, or scoreboard contexts.

### Task 2: Measure the current baseline

1. Run a warm-up, sequential samples, then bounded bursts at concurrency 2 and 4.
2. Record submission-to-terminal latency, accepted/error counts, sandbox scheduling time, node CPU/memory, Pending Pods, and Temporal backlog.
3. Stop on any 5xx, `system_error`, stuck submission, MemoryPressure, DiskPressure, or sustained readiness failure.

### Task 3: Tune one resource relationship at a time

1. Test the three-full-job profile: `caseCpuRequest=75m`, sandbox quota `pods=6`, `requests.cpu=4500m`, `requests.memory=18Gi`, judge concurrency `6`.
2. If healthy, test only one more bounded profile justified by observed CPU and memory headroom; do not reduce memory requests, limits, gVisor, NetworkPolicy, PID limits, or deadlines.
3. Restore the prior profile after every failed experiment.

### Task 4: Persist and verify the winning profile

1. Update `infra/charts/nojv/values-single-machine.yaml` and its capacity documentation.
2. Add or update the focused Helm capacity test.
3. Run both Helm renders, focused infrastructure tests, and `pnpm ci:verify`.
4. Remove the benchmark token, user, submissions, and storage objects only after confirming no benchmark workflow is active.
5. Report measured throughput and p50/p95; distinguish warm throughput from cold-start behavior.

## Acceptance

- All benchmark submissions reach a correct terminal verdict with no duplicate workflow or orphaned sandbox resource.
- The selected profile improves completed submissions per minute over baseline.
- p95 does not regress by more than 20%, and the node shows no pressure or readiness failures.
- Production returns to Flux-managed desired state with no temporary credentials or benchmark records left behind.

## Findings

- Baseline two-submission burst: 8.55 completions/minute, p50 13.913s, p95 14.033s.
- A four-submission burst fell to 7.97 completions/minute because the existing quota admitted only two full Jobs.
- Restarting the judge exposed unbounded startup recovery: every failed judge generation could be re-enqueued, and judge duplicated the platform worker's recovery scan. Recovery is now limited to the initial failed generation and removed from judge startup.
- Aggregate case output could exceed Temporal's 4 MiB activity payload limit despite per-case caps. `mapResult` now shares a 256k-byte diagnostic-output budget across all cases.
- The three-full-job profile is not safe to persist yet: three default 20-case Jobs can reach 18.75 GiB at their effective memory limits before counting the 8.8 GiB baseline services. Keep the two-job quota until a memory-saturating workload proves a safe alternative.
