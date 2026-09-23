# One sandbox per stage, per-process accounting

Status: milestones 1a–6 (payload step 1) implemented; awaiting release and the
production stress run (2026-09-23). Supersedes the per-case container layout
from PR #149.

## Why

A 20-case stage of a light C++ submission on prod (v1.3.9, n=9):

| Step                                  | p50       | Note                             |
| ------------------------------------- | --------- | -------------------------------- |
| Payload ConfigMaps                    | 0.7 s     | p90 2.8 s; created one at a time |
| Job create, Job → Pod, gVisor startup | ~3.3 s    |                                  |
| `prepare` (compile)                   | ~3 s      | 2.8 s CPU                        |
| 20 case containers started serially   | **~9 s**  | kubelet, ~0.45 s per container   |
| Programs actually running             | ~1 s      | 40–100 ms CPU per case           |
| Logs + cleanup                        | 1.7–2.5 s |                                  |
| Total                                 | **~18 s** |                                  |

A probe Job running the same 20 processes in 20 containers took 15.3 s; in
one container, 7.5 s. The per-case container is also where the timing error
comes from: `run-process.ts` charges a case with the whole container's CPU
delta, so the Node runner, its 25 ms memory poller, stdout piping and the
`bash -c 'ulimit …; exec'` wrapper are billed to the student. A program that
does nothing is reported as 30–60 ms; under the heavy stress run a self-timed
600 ms spin was reported as 770–1060 ms.

## How we got here

- 2026-05-28 (judge isolation plan): no per-case containers (throughput) and
  no in-container namespaces (the hardening forbids the privilege that
  DOMjudge `runguard` and `isolate` need). Only their run/check separation was
  adopted.
- 2026-06-12: container-level `memory.peak` rejected, because the runner
  shares the cgroup.
- 2026-06-14 (#149): per-case containers adopted so that `memory.peak` becomes
  per-case. Verified on runc.
- 2026-08-06: production moved to gVisor. gVisor emulates cgroup v1: there is
  no `memory.peak`, and `cpuacct` counts in 10 ms ticks. The reason for
  per-case containers disappeared; the layout stayed.

The missed option is the unprivileged half of `isolate`: `setrlimit` on the
child and `wait4` resource usage of the child.

## Probe (prod node, gVisor, sandbox image v1.3.9, uid 10001, restricted PSS)

| Check                                               | Result                                |
| --------------------------------------------------- | ------------------------------------- |
| `ru_maxrss` after touching 50 / 200 / 400 MB        | 52 444 / 205 928 / 411 476 KB         |
| `ru_utime + ru_stime`, self-timed 600 ms spin       | 600–610 ms (container `cpuacct` same) |
| Program that returns immediately                    | 0–10 ms                               |
| Idle `node` process for 200 ms, container `cpuacct` | 50 ms                                 |
| `RLIMIT_CPU = 1` on a 3 s spin                      | SIGXCPU at 1.00 s CPU                 |
| `mkdir /sys/fs/cgroup/…`                            | read-only file system                 |

So per-process accounting gives exact peak memory (better than today's null
`memory.peak`) and CPU without the runner. CPU resolution stays 10 ms: that is
gVisor, not our design. There are no per-case cgroups, so memory enforcement
stays "poll and kill" under a container ceiling, as today.

Testcase data on prod: 246 testcase sets, largest 15 cases, median 3.

## Invariants kept

- The student program never sees expected outputs, validators or interactor
  data; answers stay in the worker or in a container the student never shares.
- gVisor, restricted Pod Security, uid 10001, no network, read-only root.
- One sandbox Pod per stage attempt; lease, cleanup and reconcile unchanged.
- Results travel in container logs.

## Design

### A. Execution helper (items 1 and 2)

`/runner/bin/nojv-exec`, a static C binary built in the sandbox image, runs one
case:

- child: `setsid`, `RLIMIT_CPU`, `RLIMIT_FSIZE`, `RLIMIT_CORE = 0`, `exec`;
- parent: `PR_SET_CHILD_SUBREAPER`, `PR_SET_DUMPABLE = 0`, wall timer, VmRSS
  poll against the memory limit;
- when the program ends or is killed, kill and reap every remaining descendant
  before reporting, so nothing outlives the case;
- report one line: CPU (summed rusage of every reaped process), peak RSS (max),
  wall time, exit code or signal, and which limit fired.

It replaces the `bash -c 'ulimit …'` wrapper and the cgroup CPU delta in
`run-process.ts`. A C helper, not GNU `time`: the helper must be a subreaper,
kill the process group and sum reaped descendants, and Node exposes no child
rusage.

### B. Pod shape per judge type (items 1 and 3)

| Judge type  | Today                                             | New                                                                                 |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| standard    | init `prepare` + one container per case           | init `prepare` + one `run` container that runs the stage's cases                    |
| checker     | the standard Job, then a separate validator stage | init `prepare`, init `run`, then a `validate` container in the same Pod             |
| interactive | one Job per case (solution + interactor, socat)   | `solution` + `interactor` containers loop over the stage's cases on the same bridge |

- `run` executes up to P cases at a time through the helper, each in a fresh
  scratch directory.
- Checker: init containers finish before main containers start, so the
  validator never runs beside student code. `run` writes captured outputs
  (today's caps) to an `outputs` volume that `validate` mounts read-only;
  `validate` alone mounts the answers and validator. The second admission and
  Job disappear.
- Interactive stages grow from 1 case to `JUDGE_STAGE_CASES`, so the solution
  is compiled once per 20 cases instead of once per case. With the largest
  testcase set at 15, standard and checker already compile once. Reusing
  artifacts across stages waits until a problem exceeds a stage.
- The Docker executor moves to the same layout, so dev and CI exercise the
  same runner phase.

### C. Core budget (item 5)

Today up to 10 slots × 20 containers put ~200 processes on 8 cores (load 37.8).
Each stage Pod now requests and is limited to P CPUs. The judge worker's
maximum slots become ⌊judge core budget ÷ P⌋ and the sandbox ResourceQuota
`requests.cpu` equals the same budget, so no more than the budget's cases run
at once. The resource-based tuner stays below that cap as the signal that
yields to web and PostgreSQL. `judge_wall_clock_timeouts_total` is the
acceptance signal.

### D. Payload delivery (item 4)

1. Create a stage's payload ConfigMaps concurrently (today a sequential loop in
   `createPayloadConfigMaps`) and mark them `immutable: true`.
2. Then measure. If etcd writes still show, move testcase inputs to one OCI
   artifact per testcase-set version in the self-hosted registry, mounted
   through an `image` volume (prod: Kubernetes 1.36, containerd 2.3). That is
   content-addressed, cached on the node and collected by image GC, with no
   etcd write per stage. Only inputs go into the artifact. Check first that
   restricted PSS and runsc admit `image` volumes and what building the
   artifact at publish time costs.

## Milestones

Each milestone is its own PR and release.

- 1a. `nojv-exec` in the current layout. Fixes timing and memory on its own,
  because each case container already runs one program.
- 1b. Runner `run-stage` phase; Docker executor switched.
- 2. Kubernetes standard layout; per-case container code removed.
- 3. Checker in one Pod.
- 4. Interactive stages batched.
- 5. Core budget in the chart and the worker.
- 6. Payload step 1, measure, decide on step 2.

## Changes found while implementing

- **The judge moved into the Pod.** One run container's log would carry every
  case's full output: up to 16 MiB per case, 20 cases, JSON-escaped, against
  the kubelet's 64 MiB log file. The Pod now ends with a judge container that
  alone mounts answers and the validator and starts after the run init
  container has exited. The run container writes captured outputs to an
  `outputs` emptyDir and records their SHA-256 in memory, writing the index
  only after every case finished; a later case rewriting an earlier output is
  judged WA. The log carries verdicts and 64 KiB of displayed output per case.
  Docker runs the same compile, run and judge phases as three containers.
- **gVisor OOM-kills the whole container.** A probe on the prod node showed a
  child exceeding the container limit gets the container `OOMKilled`;
  `oom_score_adj` is accepted but ignored. Before this change that surfaced as
  SE. `nojv-exec` now polls the summed RSS of the program's processes every
  10 ms and kills the group above the problem limit (MLE), so the 64 MiB
  per-case headroom absorbs one allocation step. The Node memory poller is
  gone.
- **A program can kill its helper.** gVisor honours `PR_SET_DUMPABLE`: the
  program cannot open the helper's descriptors, and the report travels on a
  socket, which `/proc/<pid>/fd` cannot open. SIGKILL is still possible. A
  helper killed by a signal without a report is RE (TLE when the runner's own
  fallback timer fired), and the runner, which is PID 1, kills the orphans it
  inherits so they cannot outlive the case.
- **Interactive framing.** Several cases share one channel, so the trusted
  runners frame the conversation (`READY`, `DATA`, `EOF` per case index). A
  malformed frame or a channel closing mid-stage marks the remaining cases WA,
  since only the solution side is untrusted.
- **Waves are gone.** One Job per stage; `K8S_MAX_PARALLEL_CASES` and
  `K8S_CASE_CPU_REQUEST` are replaced by `K8S_RUN_PARALLELISM`, lowered per
  stage when the memory limit would push the run container past 1536 MiB.
- **Release note.** Interactive stage size changes from 1 to 20. An interactive
  execution in flight during the rollout would map its saved stage index onto
  the new size, so check for running interactive executions before rolling out.

## Other designs considered

| Design                                          | Isolation                                 | Why not here                                                                                                 |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| DOMjudge `runguard`                             | root supervisor: cgroup, chroot, run user | needs root and a writable cgroup tree; gVisor already isolates the host better than a user switch and chroot |
| IOI `isolate`                                   | namespaces + cgroups via a setuid binary  | same privilege; its unprivileged half (`setrlimit`, `wait4`) is what `nojv-exec` takes                       |
| nsjail                                          | user namespaces + seccomp-bpf             | user namespaces were rejected on 2026-05-28 (hardening, GKE); gVisor already filters syscalls                |
| DMOJ `cptbox`                                   | ptrace syscall filter, rusage accounting  | a second syscall filter under gVisor costs every syscall twice                                               |
| Judge0                                          | `isolate` in a privileged container       | privileged containers on a node shared with web and PostgreSQL                                               |
| Firecracker / Kata per submission               | microVM                                   | stronger than needed, heavier boot than gVisor, no gain in accounting                                        |
| Warm pool of single-use gVisor Pods, stdin feed | as today                                  | saves the ~3 s Pod start and the ConfigMaps; revisit after milestone 6 measures what is left                 |

The layout here is gVisor as the isolation boundary plus an unprivileged
supervisor inside it, which is the same split cloud judges use with microVMs.

## Acceptance

- 20-case light stage p50 ≤ 9 s (from ~18 s); light and heavy stress runs
  (`/tmp/claude-501/ops/stress`) compared with the v1.3.9 baseline (light 40:
  p50 107 s, p95 177 s).
- A program that returns immediately reports ≤ 10 ms (from 30–60 ms).
- Heavy stress: self-timed 600 ms spin reported as 600–620 ms (from 770–1060
  ms); zero wall-clock TLE.
- 50 / 200 / 400 MB touches reported within 3 %; MLE decided from peak RSS.
- The existing sandbox security tests (fork bomb, memory bomb, timeout, scratch
  isolation, answer isolation) pass on both executors, plus a test that a
  daemonized grandchild does not outlive its case.

## Risks

- Runner, helper and student program share uid 10001, as in today's per-case
  containers. A case can disturb another case in the same container, which only
  harms the same submission. The helper is non-dumpable, so a program cannot
  ptrace it or reach its descriptors through `/proc`. The runner prints the
  stage result only after every helper has returned.
- In gVisor, crossing the Pod memory limit kills the whole sandbox, so all of
  the stage's cases. The container limit must cover P × (case limit +
  headroom) plus the runner; the helper's poll kills first.
- `ru_maxrss` is per process. A program that splits memory across processes is
  bounded by the container ceiling, not the case limit.
- Update JUDGE_PIPELINE, SECURITY, the judge-queue runbook and DEPLOYMENT with
  each milestone.
