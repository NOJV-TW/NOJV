# Load-aware judge slots

Status: rolled out in v1.3.9 (2026-09-22 21:54Z) and stress-tested on prod.
v1.3.10 replaced the 10-slot ceiling with a core budget: each stage Pod reserves
`runParallelism` CPUs, so single-machine runs 5 slots × 1 CPU under a 6-CPU
quota, and the tuner stays as the signal below that cap. See the
[single-sandbox plan](2026-09-23-judge-single-sandbox-per-stage.md).

## Why

v1.3.0 made capacity a fixed number: `WORKER_CONCURRENCY` Activity slots, one
stage Job per slot. The same day's rejudge drain showed what a fixed number
cannot see:

| Observation (8-CPU node, 24 GiB)                          | Value                   |
| --------------------------------------------------------- | ----------------------- |
| Platform pods' CPU requests                               | 2.6 CPU                 |
| Stage Job request before v1.3.1 (20 cases × 100m)         | 2 CPU → 2 of 3 slots    |
| Stage Job request after v1.3.1 (20 cases × 50m)           | 1 CPU → 3 of 3 slots    |
| Node CPU usage while three Jobs run                       | 50–78%                  |
| Load average while three Jobs run                         | 8–14                    |
| Per-case CPU time / lifecycle (startup, execute, cleanup) | 80–160 ms / 1–3 s / 1 s |
| Drain throughput                                          | 2–3 executions / min    |

The gaps between Jobs (pod startup and cleanup) leave CPU idle, while the
bursts (20 gVisor containers per Job) push load above the core count. A slot
count that is right for a quiet afternoon is wrong for an exam, and the number
that fits the node changes whenever platform requests change. Kubernetes
already balances _containers on the node_ (requests are reservations, limits
are ceilings, CFS shares the rest); it does not decide _how many Jobs to
start_. That decision lives in the judge worker, so it is where the feedback
loop belongs.

## Options

### A. Temporal resource-based slot tuner (built in)

`@temporalio/worker` 1.20 exposes `tuner: { tunerOptions: { targetCpuUsage,
targetMemoryUsage }, activityTaskSlotOptions: { minimumSlots, maximumSlots,
rampThrottle } }`. The worker grants an Activity slot only while measured CPU
and memory sit below the targets, ramps up one slot per `rampThrottle`, and
stops handing out slots when the targets are exceeded. No new component, no
new queue, no scheduler. Open question: the SDK core measures the process
host; inside a pod without lxcfs that is the node (which is what we want), but
memory may follow the cgroup limit. Step 1 below settles it with a probe.

### B. Custom slot supplier on the Kubernetes metrics API

The same SDK version exposes `CustomSlotSupplier` (`reserveSlot`,
`tryReserveSlot`, `markSlotUsed`, `releaseSlot`). A supplier can read
`metrics.k8s.io` node usage (reachable in-cluster today), node allocatable
minus current requests, and the count of sandbox Pods in flight, and grant a
slot only when a Job would both schedule and stay under the CPU target. More
precise than A, ~150 lines, and only worth it if A measures the wrong thing.

### C. Kueue instead of, or in front of, Temporal

Kueue is the Kubernetes-native batch queue: Jobs are created suspended, a
ClusterQueue admits them against quotas, with priority classes, cohorts with
fair sharing, and preemption. Evaluated against what judging needs:

| Need                                                       | Temporal today                                   | Kueue                                                            |
| ---------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Per-execution state machine (lease, stages, finalize)      | `durableJudgeWorkflow`, `JudgeExecution` journal | none; a Job is admitted or not                                   |
| Retries, timers, recovery epochs, cleanup workflows        | built in                                         | none                                                             |
| Priority exam > contest > practice > recovery > rejudge    | task-queue `priorityKey`                         | PriorityClass on the Job (equivalent)                            |
| Per-student ordering and fairness                          | dispatch gate + `fairnessKey`                    | fair sharing between ClusterQueues/cohorts, not between students |
| Rejudge batches, cron singletons, lifecycle, notifications | Temporal workflows                               | out of scope                                                     |
| Capacity gate                                              | worker slots (static)                            | quota-based admission (dynamic against quota, not against load)  |
| Extra moving parts                                         | none                                             | controller, CRDs, webhooks on a single node                      |

Kueue cannot replace Temporal: everything above the capacity gate would still
be Temporal. Putting Kueue _in front of_ the Jobs recreates the problem v1.3.0
removed: an Activity would hold a slot while its Job waits for admission, or
the worker would create the Job and poll for it, which is the old
coordinator/permit loop with a different owner. Kueue also admits against
quota, not against measured load, so it does not answer the question this
plan asks. Decision: no. Revisit only if judging moves to a shared multi-node
cluster where quotas between tenants matter.

### D. HPA or KEDA on judge replicas

Scales replicas, not slots; on one node it adds nothing. It is the right tool
on GKE with the Spot burst pool and belongs in the multi-node plan, not here.

### Decision

A. Reading the SDK core (`sdk-core/.../tuner/resource_based.rs`, 1.20.3)
settled the probe question without a prod experiment: the tuner reads the
worker's own cgroup whenever that cgroup has limits, and falls back to the
host-wide `/proc/stat` CPU only when `cpu.max` is `max`. Memory keeps
following the container limit. So the judge container runs without a CPU
limit (memory limit unchanged), which makes the CPU signal the node's and the
memory signal the worker's own, which is exactly the pair we want. B is not
needed.

## Design

```
judge worker
  tuner = resource (default on single-machine) | fixed
  activity slots: min WORKER_SLOT_MIN … max WORKER_SLOT_MAX
  targets: WORKER_TARGET_CPU (0.75), WORKER_TARGET_MEMORY (0.80)
  rampThrottle: SDK default (50 ms). Every poll reserves a slot, so a long ramp
  throttles polling itself; measured on prod, a 10 s ramp started one task per
  10 s on an idle node. Burst overshoot is bounded by the ceiling instead.
sandbox quota   ≥ WORKER_SLOT_MAX × max(cpuRequest, maxParallelCases × caseCpuRequest)
LimitRange min  ≤ caseCpuRequest
```

- `WORKER_SLOT_MAX` is the timing-fidelity ceiling, not a resource number:
  each slot adds up to `maxParallelCases` gVisor containers. Start at 5 on the
  8-CPU box (100 containers worst case) and only raise it with the guard below
  green.
- Guard: `judge_wall_clock_timeouts_total` counts TLEs whose CPU time stayed
  under the limit (runs report CPU time, so a TLE below the limit was decided by
  the wall-clock ceiling: CPU contention or a sleeping program). The
  `nojv-judge-wall-clock-timeouts` alert fires on more than two in ten minutes,
  the signal to lower the ceiling.
- Workflow-task slots stay fixed (8) and the cache at 32; only Activity slots
  tune.
- Chart: `worker.judge.slots: { tuner: resource, min: 2, max: 5, targetCpu:
0.75, targetMemory: 0.8 }` on single-machine; GKE keeps `fixed` until the
  multi-node plan. `worker.judge.concurrency` remains the fixed-mode value.
- Env manifest parity: new vars carry defaults so a missing value never
  crashloops.

## Steps

1. [x] Probe (settled from source, see Decision): run a throwaway worker in the judge Deployment's image with
       `tuner.resource`, `min 1 / max 8`, target 0.5, and log
       `temporal_worker_task_slots_available` while a stress Job runs in
       `nojv-sandbox`. If slots shrink when the _node_ is busy, A is confirmed; if
       only when the worker's own container is busy, implement B.
2. [x] Worker (`WORKER_MIN_CONCURRENCY` switches the judge worker to the tuner): read the new env, build `tuner` in `worker-app.ts`, keep
       `WORKER_CONCURRENCY` for `fixed`. Unit tests on env parsing and the
       `WorkerOptions` produced for both modes.
3. [x] Metric + alert: `judge_wall_clock_timeouts_total` in `judge-phase-metrics.ts`,
       Grafana rule in `infra/grafana/alerts/slo-alerts.json`.
4. [x] Chart and docs: values, `env-manifest-parity`, DEPLOYMENT capacity table,
       `docs/runbooks/judge-queue.md` capacity section ("slots are min…max,
       watch slots_available and the wall/CPU guard").
5. [x] Rollout: `min 2 / max 10`, on the owner's call to let the node-CPU
       target rather than a low ceiling bound contention. Jobs request 0.3 CPU
       (compile 300m, case 15m, LimitRange minimum 15m) so ten schedule next to
       the platform pods; the sandbox quota is 16 pods / 16 GiB of requests.
       The tuner does not see node memory (its memory signal is the worker's
       own cgroup, verified in sysinfo 0.38.4 `cgroup_limits`), so node memory
       is watched separately. Watch concurrent sandbox Jobs, node CPU, the
       wall-clock-timeout guard and exam-lane latency under real load; lower
       `max` if the guard fires.

## Verification

- Unit: env defaults, tuner options, fixed mode unchanged.
- Local: `docker compose` Temporal + k3d is not available for gVisor; the probe
  in step 1 is the integration evidence and is recorded in this document.
- Prod acceptance: during synthetic load, slots rise to `max` while node CPU
  stays under the target, fall back to `min` within a minute of the load
  ending, and the guard p95 stays below 1.5.

## Stress test 2026-09-22

Run on prod between 20:23Z and 22:05Z (04:23–06:05 Taipei, no exam in
progress) with admin-owned practice submissions whose workflows were started
directly, so one account could fill the queue. Light: C++ solutions of Prime
Census and Island Count, 14 cases each. Heavy: a correct Prime Census solution
that spins 600 ms of CPU per case (30% of its 2 s limit).

| Run                                | Release / settings                        | Result                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A, 40 light                        | v1.3.8: 4 partitions, `rampThrottle` 10 s | 40 AC, p50 437 s; one Job at a time on an idle node until the worker was switched to fixed slots                                                                                                                                     |
| A2, 40 light                       | 1 partition, still 10 s ramp              | same stall, starts spaced exactly 10 s apart                                                                                                                                                                                         |
| A3, 40 light                       | v1.3.9                                    | 40 AC in 3 min 7 s, p50 107 s, p95 177 s; 10 Jobs after 19 s; peak node memory 7.1 GiB; 0 retries, 0 system errors                                                                                                                   |
| B, 20 heavy                        | v1.3.9                                    | 20 AC in 2 min, case CPU 770–1060 ms, load peak 37.8 on 8 cores, 0 wall-clock TLEs                                                                                                                                                   |
| P, 30 priority-5 then 5 priority-1 | v1.3.9                                    | the five priority-1 stages finished right after the ten already running (one priority-5 slipped between them); 19 of the 20 queued priority-5 finished after the last priority-1; priority-1 latency 56–61 s vs priority-5 p50 111 s |

Findings that changed the design: Temporal's default four task-queue
partitions leave tasks in unpolled partitions when pollers are few (fixed with
one partition per NOJV queue); a long `rampThrottle` throttles polling because
every poll reserves a slot (PR #509); bookkeeping activities queued behind
other submissions' Jobs (PR #510, `judge-state`); stage activities carried no
priority (PR #510); the runner's result line could be joined with its usage
line (PR #508). CPU is the real ceiling: six to ten light C++ Jobs saturate the
8-CPU node, and the tuner reaches the ceiling at the start of every burst
because the node is idle when it decides.

## Out of scope

Kueue, KEDA/HPA, changing `maxParallelCases`, multi-node scheduling. The
follow-ups already listed in
[Temporal-native judge queue](2026-09-22-temporal-native-judge-queue.md)
(subtask early exit, dropping `JudgeAdmission`) stay separate.

## References

- [Temporal-native judge queue](2026-09-22-temporal-native-judge-queue.md)
- [Judge queue runbook](../../runbooks/judge-queue.md)
- [Deployment guide](../../operations/DEPLOYMENT.md)
