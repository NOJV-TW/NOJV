# Advanced Judge: Run/Grade Split + Controlled Egress + Binary I/O

**Status:** Design (validated in brainstorming 2026-06-14, pending adversarial review)
**Scope:** Redesign Advanced Mode (`special_env`) judging
**Pre-production:** Not yet launched — no data migration burden; existing demo `special_env` problems are rewritten, the legacy single-image path is removed outright.

## Problem statement

Advanced Mode (`special_env`) currently runs the student's code **inside the TA
grader image, in the same container and as the same user** (see
`docs/architecture/JUDGE_PIPELINE.md` → "Protecting answers is the TA's
responsibility"). Three problems follow:

1. **Answer leakage / cheating.** A malicious submission can read any
   world-readable path in the grader container, including baked-in testcases /
   answers. The `run_submission` cwd-copy is explicitly *not* an isolation
   boundary. Answer protection is offloaded to TA discipline.
2. **No public network.** Advanced containers run `--network none`. Some
   problems legitimately need the student program to call a specified public
   API endpoint.
3. **No binary I/O.** Only stdin/stdout text is wired. Problems with image /
   audio / other binary inputs and outputs have no channel.

All three must be solved **without weakening the platform's security guarantee**.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Public network scope | Per-problem **allowlist** of specific endpoints (not full internet) |
| Answer isolation architecture | **Platform-managed run/grade split** (mirrors existing `checker`/`interactive`) |
| Run environment | TA-provided **run image** (custom toolchain preserved), authored from a downloadable scaffold, same as today |
| grade container network | **Full network** (trusted TA, no student code) |
| Topology owner | **Platform** owns topology + student hardening; optional **service** container supported |
| Run container's network peer | **One of** `none` / `allowlist` (platform proxy) / `service` (TA image) — mutually exclusive |
| service container network | **Full network** (trusted TA) |
| Existing problems | **Clean replacement** — not in production, no migration |

## Prerequisites / scope (this is net-new, not a refactor)

The current code is the PR #149 **single-container** model; **every** load-bearing
piece below does not exist yet and must be built, schema-first, tracing all
call sites:

- Schema migration: flat `Problem.advancedImageRef` / `advancedImageSource`
  (`packages/core/src/schemas/problem.ts`) → `advancedConfig`; the sandbox
  contract `SandboxAdvancedRequest` (`packages/core/src/sandbox.ts`) has **no**
  network/role/allowlist/service fields today. Call sites to update:
  `deriveJudgeMode` / judge-context (`packages/application/src/submission/`),
  `judge.ts buildAdvancedPayload`, `sandbox-plan.ts`, `k8s-executor.ts`,
  `docker-executor.ts`, the web edit page, seed.
- Docker network create/destroy primitives — `docker-process.ts` only removes
  containers today; per-submission `net_internal` / `net_egress` lifecycle is new.
- Sidecar (proxy/service) lifecycle + readiness + teardown; run→grade two-phase
  split; `/output` tar capture + transfer.
- `apps/worker/src/services/egress-proxy.ts` + a proxy image under `infra/docker/`
  + allowlist→config rendering — none exist.
- Role-aware upload + three scaffolds (`{run,grade,service}/`) — today's upload
  has no `role` and the scaffold is a single flat grader.

The implementation plan must front-load the schema + call-site sweep so the
"design sound but implementation lags" gap surfaces before code review, not after.

## Goals / non-goals

**Goals**

- Student code never shares a container, filesystem, or memory space with the
  answers. Answer protection becomes a **platform-level guarantee**, not TA
  discipline.
- The run container reaches **at most one** controlled network peer; never the
  open internet directly.
- Binary (image/audio/arbitrary) inputs and outputs flow losslessly between the
  run phase and the grade phase.
- Works on **both** the Docker backend (local/dev) and the Kubernetes backend
  (GKE prod). No backend is abandoned.

**Non-goals**

- Free-form TA-authored topology (e.g. uploading a `docker-compose.yml`).
  Rejected: it moves student-container hardening into TA config (large
  validation attack surface, platform can no longer *guarantee* containment) and
  cannot run on the K8s sandbox (no Docker daemon). See "Rejected: docker-compose".
- Non-HTTP egress protocols in `allowlist` mode (raw TCP/UDP to public hosts).
  The proxy enforces by hostname over HTTP(S) CONNECT. A `service`-mode TA image
  can expose any protocol *internally* if needed.
- Simultaneous `allowlist` + `service` (real public internet *and* a TA mock).
  A TA `service` image can forward to a real API itself if both are truly needed.

## Architecture

Replace "single TA image owns everything" with a **two-phase, platform-orchestrated
pipeline**, reusing the `checker`/`interactive` invariant: the container that
runs untrusted student code never holds the answers; only an isolated container
with no student code makes the grading decision.

```
run-phase                                      grade-phase (time-separated)
┌──────────────────────────────────────┐      ┌────────────────────────────┐
│ net_internal (no internet route)      │      │ grade container            │
│                                       │      │  - TA grade image          │
│  ┌───────────┐     ┌───────────────┐  │      │  - holds answers (baked)   │
│  │ run        │◄───►│ sidecar        │ │      │  - full network (trusted)  │
│  │  student   │     │ (one of):      │ │      │  - NO student code         │
│  │  code      │     │  egress-proxy  │─┼──►   │  reads run /output +       │
│  │  HTTP_PROXY│     │   →allowlist   │ │ pub  │  answers → result.json     │
│  │  no answers│     │  OR service    │─┼──►   └────────────────────────────┘
│  └───────────┘     │   (TA, full net)│ │ pub
│                     └───────────────┘  │
└──────────────────────────────────────┘
        worker captures /output ─────────────► mounted read-only into grade
```

Per submission the worker orchestrates, **all ephemeral (fresh per submission,
destroyed after)**:

1. **run-phase:** `run` container + (optionally) one sidecar (`egress-proxy` for
   `allowlist`, or `service` for `service`, or nothing for `none`).
2. worker captures the run container's `/workspace/output/` directory as raw
   bytes (tar).
3. **teardown** run + sidecar.
4. **grade-phase:** `grade` container, with the captured run output mounted
   read-only plus the baked-in answers. Writes `result.json`.

run and grade are **time-separated** — the grade container never coexists with
student code.

## Container contract

### run container (untrusted: runs student code)

```
/workspace/submission/   student files (from ZIP or wrapped single source)
/workspace/meta.json     { submissionId, language, submissionFiles, resourceLimits }
/workspace/output/       run harness writes student outputs here (binary OK)
(testcase INPUTS baked into the run image, e.g. /testcases/ — not secret)
```

The run harness (TA code, from the run scaffold) reads its baked-in inputs, runs
the student program per case with its own per-case timeout (the existing
`run_submission(cmd, stdin, timeout)` pattern), and writes per-case outputs +
status into `/workspace/output/`.

**Compile / language responsibility.** The run image bakes whatever toolchain the
problem needs; **the run harness owns compiling and running the student** (it gets
`meta.json.language` and the submission files). A compile failure is the run
harness's to detect and report (write a marker into `/output`); the grade harness
maps it to the `compile_error` verdict. `result.json` is unchanged. Whether the
run scaffold ships per-language or one toolchain image is the TA's choice — the
platform does not compile the student in Advanced Mode.

**Per-case vs whole-submission.** `advancedResultSchema.testcases` stays optional
(`packages/core/src/schemas/advanced-mode.ts`): the run/grade harnesses MAY grade
per case or as a whole. The scaffolds demonstrate the per-case loop but do not
mandate it.

### grade container (trusted: no student code)

```
/workspace/run-output/        run-phase /output, mounted READ-ONLY (binary OK)
/workspace/meta.json          { submissionId, language, runStatus }
/workspace/output/result.json grade harness writes here (existing schema)
(ANSWERS baked into the grade image, e.g. /answers/ — never exposed to student)
```

`runStatus` = worker-observed run-container outcome:
`{ state: "exited"|"timed_out"|"oom_killed", exitCode }`. The grade harness uses
it to emit TLE/RE/SE when the whole run container died catastrophically; ordinary
per-case TLE/RE is decided by the run harness and conveyed through `/output`.

The worker **must actually populate** `runStatus` (today's executor keeps
`timedOut` / `sizeExceeded` as internal vars and never writes them to meta —
`apps/worker/src/services/advanced-mode-executor.ts`): after run exits the worker
derives the state (Docker: wall-clock timeout flag + cgroup OOM / exit code;
K8s: Job status conditions), serializes it into the **grade** meta.json, and
mounts that read-only into the grade container. Two responsibilities stay on the
**worker**, not the grade harness: (1) if `/output` is missing or empty after run,
fail the submission as SE directly; (2) `runStatus` derivation. The grade meta.json
schema is exactly `{ submissionId, language, runStatus }` — it deliberately does
**not** carry `network.mode` (a proxy denial is just a connection error to the
student program, so grade never needs to know the network mode).

### service container (optional, trusted: no student code)

A TA-provided dependency the student talks to (mock API / DB / simulator).
Full network (trusted). Exposes a port the run container reaches over
`net_internal`. Run-phase only.

### egress-proxy (platform-injected, `allowlist` mode only)

A platform image (small custom forward proxy or a thin wrapper over
tinyproxy/squid). Concrete design:

- **Reachability / env.** The worker injects `HTTP_PROXY` / `HTTPS_PROXY` (and
  `http_proxy` / `https_proxy`) into the run container pointing at the proxy **by
  IP** (Docker: the sidecar's `net_internal` IP; K8s: the sidecar Pod IP or
  ClusterIP) so the run container needs **no DNS of its own**. `NO_PROXY` is left
  empty. The run container cannot usefully `unset` these to escape: with no
  internet route (Docker `--internal`; K8s NetworkPolicy) a direct connection has
  nowhere to go — the proxy is the only reachable egress.
- **Allowlist enforcement.** Allows **HTTP CONNECT / GET by host** against the
  per-problem allowlist; verifies the host on the CONNECT line and (for HTTPS)
  the TLS **SNI** match the same allowlisted name before tunnelling — rejecting
  Host/SNI mismatch to block domain-fronting. Port is constrained to the
  allowlisted `host:port` (default 80/443). Everything else → `403` + log.
  **No TLS interception** (student privacy + simplicity).
- **Config rendering.** `advancedConfig.network.allowlist` is rendered into the
  proxy's config (file/env) at sidecar start; the proxy egresses to the resolved
  hosts. Outbound DNS resolution happens **in the proxy**, not the run container.
- **Audit.** Every request logged (host + allow/deny + bytes); the worker
  collects the proxy log for operator review.
- **Resource budget.** Small fixed `requests`/`limits` (e.g. 64–128 MiB, 0.25
  CPU); see "Resource budgets & concurrency".

### `result.json` schema — unchanged

Still `advancedResultSchema` (`packages/core/src/schemas/advanced-mode.ts`):
`{ score 0..100, verdict, feedback, testcases[] }`. The grade harness owns it.
Missing/unreadable/malformed → SE via `advancedFallbackResult()`.

## Network model

Per-problem `advancedConfig.network.mode`. The run container has **at most one**
network peer:

| mode | run reaches | extra container | use |
| --- | --- | --- | --- |
| `none` (default) | nothing | — | offline judging (current behavior) |
| `allowlist` | platform egress-proxy → listed public hosts | egress-proxy | "call this public API", TA writes no service |
| `service` | TA service container (full net) | service | student talks to a mock/DB/simulator |

**Invariant:** the run container is always on a network with **no direct
internet route** and can reach **only** its single sidecar. The proxy and the
service are structurally identical — a **separate-netns sidecar, multi-homed
(internal + egress)**; only their role differs (platform allowlist enforcer vs
TA application endpoint). The sidecar **must not share a netns with run**, or run
would inherit its routes and bypass the boundary.

### Docker backend

- `none` → `--network none`.
- `allowlist` / `service` →
  - `net_internal`: a per-submission `--internal` user-defined network (zero
    external routing). `run` (+ the sidecar's first NIC) attach here. Docker's
    embedded resolver still works intra-network, but the run container is given
    the **proxy by IP** (see egress-proxy) so it needs no DNS; in `service` mode
    run reaches the service by its container-name on this network.
  - `net_egress`: a normal bridge (NAT to internet). Only the **sidecar's second
    NIC** attaches here, so only the sidecar egresses. run, being single-homed on
    `net_internal`, has no internet route — even if student code hard-codes a
    public IP, there is no route to it.
  - Both networks are created per submission and torn down with the containers;
    cleanup is best-effort on the worker's finally path (orphan-network sweep).

### Kubernetes backend

**Why separate Pods (not the `interactive` same-Pod trick).** All containers in
a K8s Pod **share one network namespace** by design, so a same-Pod sidecar would
hand the run container the sidecar's routes → instant proxy bypass. The egress
boundary therefore requires the sidecar in a **separate Pod**. (This is the one
place Advanced differs from `interactive`, which can co-locate over `127.0.0.1`
because there is no egress boundary to protect.)

- `none` → empty `NetworkPolicy` (deny all), as today.
- `allowlist` / `service`:
  - **Deny-all is additive and cannot be narrowed.** Today's blanket deny-all
    (`infra/k8s/sandbox/network-policy.yaml`, `infra/gcp/gke/network-policy.yaml`)
    matches every sandbox Pod; a per-submission "allow egress to sidecar" policy
    can't override it. Fix: relabel the deny-all `podSelector` to
    `matchExpressions: [{ key: nojv.egress, operator: DoesNotExist }]` so it does
    **not** match Pods carrying `nojv.egress=<submission-id>`, and emit a
    per-submission `NetworkPolicy` allowing the run Pod egress **only** to the
    sidecar Pod (label selector) + kube-dns. Both the policy and its label are
    created and torn down per submission.
  - **Sidecar workload + readiness.** The sidecar runs as a per-submission Pod
    (proxy or service), exposed by a ClusterIP Service; the run Job is created
    **after** the worker polls the sidecar to Ready (K8s has no Job→Job ordering
    primitive — the worker does the polling). Sidecar crash before/during run →
    detected by the worker → submission SE.
  - **Cross-Pod `/output` transfer (no shared emptyDir across Pods).** The run
    Pod's emit container **tars `/workspace/output/` to stdout** between markers;
    the worker captures it via the Pod-logs API — the same log-tailing pattern the
    current `emit-result` sidecar already uses (`k8s-advanced.ts`), so no PV and no
    ConfigMap 1 MB limit. (`--dereference` tar safety from the Binary I/O section
    applies here too.)
  - sidecar egress is independent (proxy → allowlisted hosts; service → full).
  - This multi-Pod orchestration (start sidecar Pod + per-submission NetworkPolicy,
    await ready, run Job, capture tar, teardown, then grade Job) is the heaviest
    new piece in the K8s executor.

## Binary I/O

The worker moves a **raw byte directory (tar)** between run and grade, never a
JSON string or stdin text — so image/audio/binary files survive intact.

- Inputs: baked into the run image; the run harness feeds the student however it
  likes (stdin, files). Binary-safe because it is the TA's own code.
- Outputs: the student/run harness writes arbitrary files to `/workspace/output/`;
  the worker tars them and mounts them read-only at `/workspace/run-output/` in
  grade. The grade harness does the actual image/audio decode + comparison in code
  (Pillow / librosa / etc., baked into the grade image).

This promotes the previously-ignored `artifacts/` directory to the official
run→grade I/O bus. The platform never interprets binary semantics.

### Tar safety (a security gate — the `/output` capture must not become an answer leak)

`/output` is written by untrusted student code, so the capture is hardened:

- **Tar happens inside the run container, before teardown, with `--dereference`.**
  Symlinks therefore resolve in the **run** filesystem — which contains **no
  answers** — so a malicious `output/x → /answers/secret` symlink dereferences to
  a non-existent path and is dropped, never reaching grade. Tarring in the worker
  after the fact would resolve such a link in a context that could see other
  mounts → that is the leak we must avoid. (Note: even though run has no answers,
  `--dereference` + run-context tarring is what makes the property hold by
  construction rather than by luck.)
- **Skip special files** (FIFOs, sockets, device nodes) — they can hang tar /
  the extractor (DoS).
- **Bound the tree before transfer**: reject if file count or directory depth
  exceeds a cap (e.g. ≤ 100k files), and extend the existing `/workspace` size
  watchdog (`advanced-mode-executor.ts` `dirSizeBytes`, today byte-sum only) to
  also count **inodes/files** so a million 1-byte files can't exhaust fds or OOM
  the tar under the 1 GiB byte cap.
- An `/output` that violates these (special files, over-cap tree, tar failure) is
  a defined failure mode → submission SE; grade is not started.

## Security hardening matrix

| | run | grade | service | egress-proxy |
| --- | --- | --- | --- | --- |
| runs student code | **yes** | no | no | no |
| trust | untrusted | trusted | trusted | platform |
| network | only its sidecar (or none) | full | full | internal in + allowlisted egress out |
| `--user` non-root | **yes (10001)** | no (TA-managed, as today) | no | yes |
| `--cap-drop ALL` | yes | yes | yes | yes |
| `no-new-privileges` | yes | yes | yes | yes |
| `--read-only` rootfs | yes | yes | yes | yes |
| writable | `/tmp` tmpfs, `/workspace` bind | `/tmp`, `/workspace` | `/tmp` | `/tmp` |
| memory / cpu / pids | `memoryLimitMb` / bounded | own (generous) | own | small |
| `/workspace` 1GiB disk watchdog | yes | yes | n/a | n/a |
| holds answers | **never** | yes (baked) | never | never |

The run container keeps the strictest posture (it is the only one running
untrusted code). grade/service stay on the existing "trusted TA, no `--user`"
posture.

**Trust boundary for the `service` container (explicit).** A full-network
`service` is a deliberate trust choice consistent with `docs/operations/SECURITY.md`
(TAs are trusted). Consequences and bounds: a malicious TA could write the service
as an open relay — accepted, because it cannot reach the **answers** (those live
only in grade) and so cannot break the core guarantee; the worst case is network
abuse by a trusted author, mitigated by (a) the service Pod's `NetworkPolicy`
ingress allowing **only** the run Pod (label selector), (b) the per-image upload
being an authenticated TA action, and (c) egress logging. A future option is an
egress allowlist on the service too; out of scope now.

## Schema / DB

Replace the single `Problem.advancedImageRef` / `advancedImageSource` columns
with a Zod-validated JSON column `advancedConfig` (mirrors the existing
`judgeConfig` pattern), keeping per-role image refs for the tarball
`docker load` cache:

```jsonc
advancedConfig: {
  run:   { imageRef: string, imageSource: "registry" | "tarball" },
  grade: { imageRef: string, imageSource: "registry" | "tarball" },
  network: {
    mode: "none" | "allowlist" | "service",          // default "none"
    allowlist?: string[],                              // mode = "allowlist", e.g. ["api.example.com:443"]
    service?: { imageRef: string, imageSource: "registry" | "tarball" }  // mode = "service"
  }
}
```

`special_env` problem validation (`packages/core/src/schemas/problem.ts`):
require `run` + `grade`; require `network.allowlist` non-empty iff
`mode = "allowlist"`; require `network.service` iff `mode = "service"`.

### Reproducibility: snapshot `advancedConfig` on the submission

Because `advancedConfig` (including up to three image refs) now lives on the
mutable `Problem`, a **rejudge** that re-reads the current Problem would silently
grade an old submission with newer images → non-reproducible. The submission
must **snapshot** the `advancedConfig` used at judge time (a denormalized column
or embedded in the stored verdict metadata); rejudge and plagiarism read the
snapshot, not the live Problem. This snapshot is part of the schema work and its
own migration.

## Authoring / upload

- **Scaffolds:** `GET /api/problems/advanced-scaffold?role=run|grade|service`
  streams a per-role starter zip:
  - **run** — `runner.py` (load meta, run student, write `/output`) +
    `Dockerfile` baking testcase **inputs**.
  - **grade** — `grader.py` (read `/run-output` + `/answers`, write
    `result.json`) + `Dockerfile` baking **answers** + a shared `nojv_grader.py`
    helper (validate/normalize verdicts, `write_result`).
  - **service** — a minimal HTTP service example.
- **Upload:** extend the advanced-image upload endpoint with a `role`
  (`run`/`grade`/`service`). tar magic validation unchanged. Store at
  `problems/{id}/advanced-images/{role}/{uuid}.tar`, write back the matching
  ref/source. The per-storage-key `docker load` cache is keyed by role. The 64 MB
  cap (`advanced-image/+server.ts`) now applies **per role**; heavyweight ML
  graders may exceed it, so make the cap configurable (and prefer `registry`
  sources for large images, which carry no upload cap).

## Result flow / limits / timeouts / failure modes

- Resource limits reuse `Problem.timeLimitMs` / `memoryLimitMb`:
  - run container: cgroup memory = `memoryLimitMb`, outer wall =
    `totalTimeMs + grace` (covers harness + student).
  - grade / service / proxy: **explicit** requests/limits (not "unbounded"):
    proxy small fixed (≈64–128 MiB, 0.25 CPU); grade/service a generous-but-capped
    default (e.g. 1 GiB / 1 CPU, overridable per problem). Unbounded sidecars ×
    concurrent submissions is a cluster-DoS risk.
  - `/workspace` size watchdog applied per phase (run, grade); see Tar safety for
    the inode/file-count extension.
- **Concurrency.** Up to 4 ephemeral containers per submission × N concurrent
  submissions; the worker enforces a max in-flight Advanced submissions cap (and
  on K8s a namespace `ResourceQuota`) so sidecars can't exhaust the node/cluster.
- **Timeout budget.** The `judgeSandbox` activity must cover
  `sidecar_ready + run_wall + tar_capture + teardown + grade_wall + grace`. With
  two sequential phases each up to `totalTimeMs`, the activity `startToCloseTimeout`
  (today `10m`) and the per-phase deadlines must be set from this formula, and a
  `totalTimeMs` large enough to blow the activity budget is rejected at problem
  save time rather than failing mysteriously at judge time.
- Failure modes → System Error (`advancedFallbackResult`): sidecar fails to
  start; run produces no `/output`; grade produces no/invalid `result.json`.
  In `allowlist` mode a proxy denial surfaces to the student program as an
  ordinary connection error — **not** SE.

## Backend implementation map

New/changed code (to be detailed in the implementation plan):

- `apps/worker/src/services/advanced-mode-executor.ts` — split into run-phase +
  grade-phase orchestration; sidecar (proxy/service) lifecycle; `/output`
  capture + transfer.
- New `apps/worker/src/services/egress-proxy.ts` (or an asset image under
  `infra/docker/`) — the platform forward proxy + allowlist config rendering.
- `apps/worker/src/services/k8s-advanced.ts` / `k8s-executor.ts` — multi-Pod
  run + sidecar + NetworkPolicy; separate grade Job.
- `packages/core/src/schemas/advanced-mode.ts` + `problem.ts` — `advancedConfig`.
- `apps/web/.../advanced-image/+server.ts` + scaffold route — `role` support.
- `apps/web/src/lib/server/advanced-scaffold/files/{run,grade,service}/` — scaffolds.
- `infra/k8s/sandbox/` + `infra/gcp/gke/` — NetworkPolicy variants for
  `allowlist`/`service`.

## Testing strategy

- **Unit:** `advancedConfig` Zod schema; mode derivation; proxy allowlist
  hostname matching.
- **Integration:** executor wiring against a mocked Docker/K8s.
- **Real-machine smoke** (lesson: sandbox docker-arg bugs only surface on real
  judging runs): one run/grade-split problem per mode (`none`, `allowlist`,
  `service`), end-to-end AC.
- **Adversarial security tests** (core): a malicious submission must **fail** to
  ① read `/answers` from the run container, ② reach a non-allowlisted host,
  ③ reach the grade container, ④ leak an answer via an `output/x → /answers/...`
  symlink (must be dropped by the run-context `--dereference` tar), ⑤ escape the
  allowlist by unsetting `HTTP_PROXY` / hard-coding a public IP (no route), ⑥
  exhaust resources via a million-file or special-file `/output` (watchdog +
  count cap → SE). Plus binary I/O round-trip (image in → image out → graded).

## Rejected: docker-compose as the contract

Letting TAs upload a `docker-compose.yml` was considered and rejected:

1. **Loses the security guarantee.** Student-container hardening
   (network/caps/user/read-only/seccomp/limits) would move into TA-authored
   compose config; the platform could no longer *guarantee* the untrusted
   container is locked down, and would need a large, fragile compose validator
   that first has to identify which service runs student code.
2. **Breaks the K8s prod backend.** `docker compose` needs a Docker daemon; the
   GKE sandbox is containerd + Jobs. Compose would force all Advanced Mode back
   to Docker-only, regressing the production path.
3. **Doesn't remove the proxy.** Reaching a *real* public API still needs the
   platform egress-proxy regardless; a self-contained compose stack can't do it
   safely on its own.

The platform owns topology + hardening; the TA owns image **content** + a few
declared knobs (images, network mode, allowlist). This is the safe, bounded
version of "compose".

## Related docs

- [Judge Pipeline](../../architecture/JUDGE_PIPELINE.md) — Advanced Mode section
  to be rewritten once this lands.
- [Security Requirements](../../operations/SECURITY.md)
- [Threat Model](../../operations/THREAT_MODEL.md)
