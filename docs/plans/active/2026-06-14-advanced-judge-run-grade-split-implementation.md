# Advanced Judge Run/Grade Split — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Advanced Mode's single-container "TA owns everything" judging with a platform-orchestrated run/grade split that guarantees student code never holds the answers, adds per-problem controlled egress (`none`/`allowlist`/`service`), and a lossless binary I/O bus — on both Docker and Kubernetes.

**Architecture:** Two time-separated phases per submission. A `run` container (untrusted student code, at most one network sidecar, no answers) writes `/output`; the worker tars it (inside the run container, `--dereference`, the security gate) and mounts it read-only into a `grade` container (trusted TA code, holds baked-in answers, full network, no student code) which writes `result.json`. See the design doc: `docs/plans/active/2026-06-14-advanced-judge-run-grade-split-design.md` — it is the source of truth for every contract; this plan only sequences the build.

**Tech Stack:** TypeScript ESM, Temporal worker, Zod 4, Prisma 7, Docker CLI + Kubernetes (`@kubernetes/client-node`), Vitest, SvelteKit.

**Companion docs:**
- Design (contracts/specs): `docs/plans/active/2026-06-14-advanced-judge-run-grade-split-design.md`
- Parity audit conclusion: standard/checker/interactive are already safe — **do not** modify them; only a doc note in Phase 8.

**Execution discipline:** TDD throughout (test → red → minimal impl → green → commit). DRY, YAGNI, frequent commits. Each task ends with `pnpm lint && pnpm test:unit` (plus the task's targeted tests) green before commit. Run `pnpm test:integration` at phase boundaries. The security-critical tasks (2.1, 3.3, 5.2) additionally require real-machine verification (Phase 8 smoke) before the feature is considered done.

**Granularity note:** Phases 0–2 (schema + Docker split + the tar security gate) are specified at fine bite-sized granularity. Phases 3–8 are task-level with concrete files, approach, and acceptance criteria; expand each into bite-sized steps when reached (the design doc already pins the contracts).

**Repo conventions (verified in the worktree):**
- Tests are **NOT co-located**. Unit tests live in `tests/unit/<area>/*.test.ts`
  (areas: `core`, `domain`, `worker`, `sandbox-runner`, `web`, `db`, `temporal`,
  `redis`, `storage`, `infra`, `docs`); integration in `tests/integration/**`;
  e2e in `tests/e2e/**`. Run with `pnpm test:unit tests/unit/<area>` /
  `pnpm test:integration`. There is **no** per-package `test` script.
- Tests import through the package barrel (e.g. `import { advancedResultSchema } from "@nojv/core"`), not deep relative paths.
- `advancedResultSchema` and its test (`tests/unit/core/advanced-mode-schema.test.ts`)
  already exist — **extend**, don't recreate.
- Existing advanced tests to revise under the clean replacement:
  `tests/e2e/advanced-mode-lifecycle.test.ts`, `tests/e2e/advanced-required-paths.test.ts`,
  `tests/unit/web/advanced-scaffold.test.ts` (+ any `advancedRequiredPaths` references).
- Every "Test:" path below resolves to this layout (the per-task hints predate the
  verification and may say "co-located" — use `tests/unit/<area>/` instead).

---

## Phase 0 — Schema & contract (schema-first, then call-site sweep)

Nothing runs until the types exist. Build the schema, migration, and make every
existing call site compile against it before touching executor behavior.

> **Execution note (decided during execution, 2026-06-14):** A blast-radius scan
> showed `advancedImageRef`/`advancedImageSource` are woven across 15+ files
> (core schema, application mutations/queries, submission context, prisma seed,
> web edit/upload/components/types). Replacing them is an **atomic refactor** —
> splitting Tasks 0.2–0.5 into independently-green commits is impossible (any
> partial change breaks compilation of the others). So Phase 0 is executed as
> **one consolidated migration** (Task 0.1 schema already done). Two scope
> decisions to keep it tractable and keep `ci:verify` green at the phase boundary:
> 1. **Defer `advancedRequiredPaths` removal** — it is an orthogonal UI feature;
>    keep it intact for now, remove it in a later cleanup task.
> 2. **Executor transitional shim** — `AdvancedModeContext` moves to the new
>    `{run, grade, network, resourceLimits}` shape, but the Docker/K8s advanced
>    executors temporarily treat `advancedConfig.grade.imageRef` as the old single
>    image (preserving current single-container behavior). The real run/grade
>    split is Phase 1. Seed sets `run` and `grade` to the existing demo image so
>    the advanced-mode integration/e2e tests keep passing — **no test skips**.

### Task 0.1: `advancedConfig` Zod schema

**Files:**
- Modify: `packages/core/src/schemas/advanced-mode.ts` (add `advancedConfigSchema` + `imageRefSchema`)
- Modify: `packages/core/src/index.ts` (export the new schemas/types via the barrel)
- Test: `tests/unit/core/advanced-mode-schema.test.ts` (exists — extend it)

**Step 1 — failing test.** Add tests asserting `advancedConfigSchema` parses a
valid `{ run, grade, network:{mode:"none"} }`, rejects a missing `grade`, requires
`network.allowlist` non-empty when `mode:"allowlist"`, and requires
`network.service` when `mode:"service"`:

```ts
import { advancedConfigSchema } from "@nojv/core";
it("requires grade image", () => {
  expect(advancedConfigSchema.safeParse({ run: img, network: { mode: "none" } }).success).toBe(false);
});
it("allowlist mode requires non-empty allowlist", () => {
  expect(advancedConfigSchema.safeParse({ run: img, grade: img, network: { mode: "allowlist", allowlist: [] } }).success).toBe(false);
});
```
(`const img = { imageRef: "ghcr.io/x:1", imageSource: "registry" }`.)

**Step 2 — run, expect FAIL** (`advancedConfigSchema` undefined):
`pnpm --filter @nojv/core test advanced-mode`

**Step 3 — implement.** Add `imageRefSchema = z.object({ imageRef: z.string().min(1), imageSource: z.enum(["registry","tarball"]) })` and `advancedConfigSchema` with a `superRefine` enforcing the allowlist/service conditionals. Keep `advancedResultSchema` unchanged.

**Step 4 — green.** Same command.

**Step 5 — commit:** `feat(core): add advancedConfig schema for run/grade split`

### Task 0.2: `special_env` problem validation

**Files:**
- Modify: `packages/core/src/schemas/problem.ts` (currently flat `advancedImageRef`/`advancedImageSource`/`advancedRequiredPaths` ~lines 90–138; also owns `problemImageSourceSchema` ~lines 18–19)
- Modify: `packages/core/src/schemas/advanced-mode.ts` (enum unification — see below)
- Test: `tests/unit/core/` (e.g. extend `schemas.test.ts` or add `problem-advanced-config.test.ts`)

**Steps:** TDD that a `special_env` problem requires a valid `advancedConfig` and that non-`special_env` problems reject it. Replace the flat-field validation with `advancedConfig`. Remove `advancedRequiredPaths` (it was a single-image concept). Commit: `feat(core): validate special_env problems against advancedConfig`.

**Carried over from Task 0.1 code review (do here, where problem.ts is already open):**
- **Single-source the image-source enum.** Task 0.1 inlined `z.enum(["registry","tarball"])` in `advanced-mode.ts`; `problem.ts:18-19` already exports `problemImageSourceSchema` for the same concept. Unify to ONE canonical enum. Direction matters to avoid a cycle: since `problem.ts` will now import `advancedConfigSchema` from `advanced-mode.ts`, the canonical enum must live in `advanced-mode.ts` (export `imageSourceSchema` there) and `problem.ts` should import/re-export it — NOT the reverse.
- **i18n validation messages.** `advanced-mode.ts`'s `advancedConfigSchema` superRefine currently emits prose English strings; `problem.ts`'s superRefine uses i18n keys (`validation_required`, etc.) because these surface in the authoring UI. When wiring `special_env` validation, decide whether the advancedConfig messages need i18n keys; if the authoring UI renders them, convert to keys for consistency.

### Task 0.3: extend the sandbox contract

**Files:**
- Modify: `packages/core/src/sandbox.ts` (`SandboxAdvancedRequest`, ~18–23 — today only `imageRef/imageSource/totalTimeMs/memoryMb`)
- Test: alongside.

**Steps:** TDD the new shape: `{ run, grade, network, resourceLimits }` where `network = { mode, allowlist?, service? }`. The executor must receive everything it needs to wire topology. Commit: `feat(core): carry run/grade/network in SandboxAdvancedRequest`.

### Task 0.4: Prisma schema + migrations

**Files:**
- Modify: `packages/db/prisma/schema/problem.prisma` — drop `advancedImageRef`/`advancedImageSource`/`advancedRequiredPaths`; add `advancedConfig Json?`.
- Modify: `packages/db/prisma/schema/submission.prisma` — add `advancedConfigSnapshot Json?` (for Phase 7 reproducibility).
- Create: migration under `packages/db/prisma/migrations/`.

**Steps:** edit schema → `pnpm db:generate` → create migration (`pnpm db:migrate` dev) → confirm `DATABASE.generated` drift gate passes (`pnpm --filter @nojv/db ...` per repo convention). No data migration (pre-production). Commit: `feat(db): replace flat advanced image columns with advancedConfig (+submission snapshot)`.

### Task 0.5: call-site sweep (make it compile, behavior unchanged for mode=none)

**Files (modify):**
- `packages/application/src/submission/queries.ts` — `deriveJudgeMode`, `AdvancedModeContext` build (~366–443): read `advancedConfig` instead of flat fields.
- `packages/application/src/submission/types.ts` — `AdvancedModeContext` shape.
- `apps/worker/src/activities/judge.ts` — `buildAdvancedPayload`/advanced request build.
- `apps/worker/src/services/sandbox-plan.ts` — advanced plan.
- `apps/worker/src/services/docker-executor.ts` + `k8s-executor.ts` — dispatch reads new fields.
- `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.server.ts` — load/save `advancedConfig`.
- `packages/db/prisma/seed.ts` — temporary: set a minimal `advancedConfig` so seed compiles (real dual-image demo in Task 8.4).

**Steps:** Update each, keep `deriveJudgeMode` semantics identical (`problemType === "special_env" && advancedConfig != null`). Update the `deriveJudgeMode` unit test. Run `pnpm build` + `pnpm test:unit`. This task is "green compile + existing tests pass", no new behavior. Commit: `refactor: thread advancedConfig through judge call sites`.

**Phase 0 gate:** `pnpm ci:verify` green (schema + call sites coherent, no behavior change yet).

---

## Phase 1 — Docker run/grade split (mode=none)

Split `AdvancedModeExecutor` into two phases. No network sidecar yet.

### Task 1.1: split workspace preparation

**Files:**
- Modify: `apps/worker/src/services/advanced-mode-executor.ts` (`prepareWorkspace`, ~118–155)
- Test: `apps/worker/src/services/advanced-mode-executor.test.ts`

**Steps (TDD):** Introduce `prepareRunWorkspace()` (writes `submission/` + run `meta.json={submissionId,language,submissionFiles,resourceLimits}`, empty `output/`) and `prepareGradeWorkspace(runOutputTar, runStatus)` (extracts run output to `run-output/`, writes grade `meta.json={submissionId,language,runStatus}`, empty `output/`). Unit-test the meta.json contents and directory layout via a temp dir. Commit: `feat(worker): split advanced workspace into run and grade`.

### Task 1.2: two-phase orchestration + runStatus

**Files:**
- Modify: `apps/worker/src/services/advanced-mode-executor.ts` (`run`, `spawnContainer`, `buildAdvancedDockerArgs` ~57–246)

**Steps (TDD with mocked docker spawn):**
1. Run phase: spawn the **run** image with the run workspace, the existing hardening (`--cap-drop ALL`, `no-new-privileges`, `--read-only`, `--user 10001`, tmpfs `/tmp`, `--memory`/`--pids`), `--network none` for now. Capture exit + wall-clock-timeout + OOM into `runStatus = { state, exitCode }`.
2. Capture `/output` (plain copy for now; tar safety lands in Phase 2).
3. Grade phase: spawn the **grade** image with the grade workspace, full network (`--network bridge`), no `--user` (trusted, as today). Read `output/result.json`, validate `advancedResultSchema`.
4. Map to `SandboxResult` via the existing `sandbox-result-mapper.ts`.

Unit-test: run-then-grade ordering; `runStatus` reflects a simulated timeout; grade reads result. Commit: `feat(worker): orchestrate advanced run then grade phases`.

### Task 1.3: ~~worker-side SE on missing/empty output~~ — SUPERSEDED

**Decision (Phase 1):** An empty `/output` is NOT an SE. It is a legitimate
outcome (student printed nothing → grade renders WA/RE via `runStatus`), so the
worker **always proceeds to grade** after a non-infrastructure-failing run and
funnels the outcome through `runStatus`. The worker SEs only on infrastructure
failures (run/grade spawn error, run size-cap, grade timeout, missing/invalid
`result.json`). See the design doc "Verdict ownership" note. No separate
empty-output SE code. ✅ Done as part of Task 1.2.

**Phase 1 status:** ✅ DONE (`f7d85da9`). Real-docker dual-image end-to-end is a
**Phase 8 smoke** item (the executor's `run()` is not exercised by `ci:verify` —
only the pure helpers are unit-tested; real judging is local-e2e / nightly). The
Phase 1 unit tests cover run-vs-grade args, `deriveRunStatus`, and the meta-field
split.

---

## Phase 2 — Binary I/O + tar safety (the security gate)

### Task 2.1: tar `/output` inside the run container with `--dereference`

**Files:**
- Modify: `apps/worker/src/services/advanced-mode-executor.ts` (output capture)
- Test: `apps/worker/src/services/advanced-mode-executor.test.ts` + an adversarial fixture under `tests/`

**Steps (TDD — this is security-critical, write the attacks first):**
1. **Failing adversarial test:** a run fixture that writes `output/leak -> /answers/secret` (symlink) and a normal `output/ans.txt`. Assert the captured archive contains `ans.txt`'s content and **not** any `/answers` content (the symlink dereferences to a non-existent path in the answer-free run fs → dropped).
2. Implement: capture by running, **inside the run container before teardown**, `tar --dereference --hard-dereference -cf - -C /workspace/output --exclude-special-files? .` (GNU tar: skip FIFOs/sockets/devices via pre-scan or `--warning=no-file-ignored` + a node-side filter; if BusyBox tar in the base image lacks flags, bake GNU tar into the run base image — note in the run scaffold). Stream stdout to the worker.
3. **Special-file test:** run fixture writes a FIFO in `/output` → capture skips it (or fails to SE if unsafe). Assert no hang.
4. **Count-cap test:** run fixture writes >cap files → SE.

Commit: `feat(worker): capture advanced /output via in-container --dereference tar (answer-leak gate)`.

### Task 2.2: extend the workspace watchdog with inode/file count

**Files:**
- Modify: `apps/worker/src/services/advanced-mode-executor.ts` (`dirSizeBytes` ~22–43, `WORKSPACE_POLL_INTERVAL_MS`)

**Steps (TDD):** Add a file-count accumulator next to the byte sum; force-remove + SE when either the 1 GiB byte cap or the file-count cap (e.g. 100k) is exceeded. Test with a synthetic directory. **Also close the Phase 1 test gap:** the existing `dirSizeBytes` cap test (`tests/unit/worker/advanced-mode-executor.test.ts`) is a near-tautology (never exceeds the 1 GiB cap); add a real cap-exceeded assertion (e.g. inject a lowered cap / count threshold) so the watchdog trigger is genuinely exercised. Commit: `feat(worker): bound advanced /workspace by file count, not just bytes`.

### Task 2.3: mount run-output read-only into grade

**Steps (TDD):** Grade gets `run-output/` as a read-only mount; binary bytes round-trip. Integration test: a PNG written by run is byte-identical in grade's `run-output/`. Commit: `feat(worker): pass binary run output losslessly to grade`.

**Phase 2 gate:** the adversarial suite (symlink-leak, special-file, count-cap) + binary round-trip all green. `pnpm test:integration` green.

---

## Phase 3 — egress-proxy + `allowlist` mode (Docker) — ✅ DONE (`26bd9f31`/`98baa9e6`/`9e9cb9f7`)

**As shipped** (differs from the original task sketch below; recorded here):
- `infra/docker/egress-proxy/proxy.mjs` (dependency-free Node CONNECT+HTTP forward
  proxy, exports `matchesAllowlist`/`parseAllowlist`, prints `NOJV_PROXY_READY` on
  listen) + `Dockerfile` (`node:24-alpine`, non-root, hardened); built via
  `pnpm egress-proxy:build`.
- `docker-network.ts` (per-submission `net_internal --internal` + `net_egress`,
  **Docker-IPAM auto subnet** — no static IP; orphan sweep at worker startup) +
  `egress-proxy.ts` (lifecycle, allowlist→env, readiness poll via `docker logs`,
  bounded audit-log capture) + run-phase wiring in `advanced-mode-executor.ts`.
- Proxy IP discovered via `docker inspect` after start (eliminates subnet
  collisions); run container single-homed on `net_internal` with `HTTP_PROXY` by IP.
- **Allow/deny by CONNECT request-line host:port.** Decision is on the CONNECT
  host, no TLS interception.
- **SNI verification DEFERRED** (future hardening): domain-fronting does not break
  answer protection (run holds no secrets); recorded as a known residual limit in
  the design doc's egress-proxy section. Not implemented; no `Host/SNI mismatch`
  test.
- Unit-tested: `matchesAllowlist`/`parseAllowlist` (incl. IPv6 brackets,
  fail-closed), env rendering, IPAM/proxy/run docker-arg builders, the
  single-homed-run security invariant, bounded audit buffer.
- **Real-docker behavior verified by local smoke** (not in `ci:verify`): allowlisted
  host → 200; non-allowlisted → 403; `HTTP_PROXY` unset → no route (`--internal`
  is the real boundary); audit log captured. These become the Phase 8 smoke checks.

<details><summary>original task sketch (superseded)</summary>

Task 3.1 egress-proxy image + matcher; Task 3.2 wire networks (originally a
static-IP `net_internal`, replaced by Docker IPAM + inspect during review); Task
3.3 allowlist behavior + audit (the integration checks are real-docker, so they
are Phase 8 smoke, not `ci:verify`). Phase 3 gate (no orphan networks after a run)
is satisfied by the startup `sweepOrphanNetworks` + `finally` teardown.
</details>

---

## Phase 4 — `service` mode (Docker) — ✅ DONE (`2e60da23`)

**As shipped:** new `apps/worker/src/services/service-container.ts` (lifecycle modeled
on `egress-proxy.ts`); the TA `service` image runs on `net_internal` (alias `service`)
+ `net_egress` (full network, trusted, hardened, no `--user`), best-effort readiness via
a `NOJV_SERVICE_READY` log marker (proceeds regardless), torn down in `finally`. The run
container is single-homed on `net_internal` with `NOJV_SERVICE_HOST=service`, no
`HTTP_PROXY`, keeps `--user 10001`. Security invariant (run single-homed, never egress)
locked by unit test. Real reachability/isolation is Phase 8 smoke.

> **Tracked cleanup for Phase 5:** `service-container.ts` and `egress-proxy.ts` share
> near-verbatim `collect*Logs` / `sleep` / start-stop skeleton. When the K8s sidecar
> (Phase 5) becomes the third sidecar call site, extract a shared helper
> (`collectContainerLogs`, `pollLogsForMarker(name, marker, {timeoutMs, throwOnTimeout})`,
> `sleep`) into `docker-process.ts`, leaving only the per-role arg builders divergent.

### Task 4.1: service container lifecycle
- Modify: `advanced-mode-executor.ts` — start the TA `service` image on `net_internal` (full net via a second NIC on `net_egress`, trusted), poll readiness, then start run; teardown after run.
- Service Pod/container `--cap-drop ALL`/`--read-only`/`no-new-privileges` (trusted but still hardened); ingress effectively only from run (single shared `net_internal`).
- Commit: `feat(worker): service-mode sidecar for advanced run phase (docker)`.

### Task 4.2: wire + test
- Run reaches the service by container-name on `net_internal`; run still cannot reach the internet directly.
- Integration test: run calls the service, service responds; run cannot reach an external host.
- Commit: `test(worker): service-mode reachability + isolation (docker)`.

---

## Phase 5 — Kubernetes backend (all modes)

### Task 5.1: split the advanced Job into run + grade
- Modify: `apps/worker/src/services/k8s-advanced.ts` (currently one Job, shared emptyDir ~97–190) + `k8s-executor.ts` `executeAdvanced`.
- Run Job: emit container tars `/workspace/output` to **stdout** between markers; worker captures via pod-logs (reuse the `emit-result` log-tail pattern). Grade Job runs after, with run output materialized from the captured tar.
- Commit: `feat(worker): split advanced k8s into run and grade jobs with pod-log tar transfer`.

### Task 5.2: NetworkPolicy (deny-all relabel + per-submission egress) — security-critical
- Modify: `infra/k8s/sandbox/network-policy.yaml`, `infra/gcp/gke/network-policy.yaml` — deny-all `podSelector` → `matchExpressions:[{key: nojv.egress, operator: DoesNotExist}]`.
- Emit a per-submission `NetworkPolicy` allowing the run Pod (label `nojv.egress=<submission-id>`) egress **only** to the sidecar Pod + kube-dns; create/teardown lifecycle.
- Commit: `feat(infra,worker): per-submission egress NetworkPolicy for advanced run pod`.

### Task 5.3: sidecar Pod (proxy/service) + Service + readiness
- Modify: `k8s-executor.ts`/`k8s-advanced.ts` — sidecar as a per-submission Pod + ClusterIP Service; worker polls Ready before creating the run Job; sidecar crash → SE.
- Inject `HTTP_PROXY` by sidecar IP/ClusterIP.
- Commit: `feat(worker): advanced sidecar pod + readiness wait (k8s)`.

### Task 5.4: timeout formula + teardown
- Set run/grade Job `activeDeadlineSeconds` and the `judgeSandbox` activity timeout from `sidecar_ready + run_wall + tar + teardown + grade_wall + grace`; reject oversized `totalTimeMs` at problem save (Task 6.3).
- Teardown sidecar Pod + per-submission NetworkPolicy + Service in `finally`.
- Commit: `feat(worker): advanced k8s timeout budget + teardown`.

**Phase 5 gate:** mocked-k8s integration tests for all three modes; manual OrbStack k8s smoke (per project memory: `orbctl start k8s`) deferred to Phase 8.

---

## Phase 6 — Web (schema UI, role upload, scaffolds)

### Task 6.1: role-aware upload
- Modify: `apps/web/src/routes/api/problems/[id]/advanced-image/+server.ts` — accept `role` (`run`/`grade`/`service`); store `problems/{id}/advanced-images/{role}/{uuid}.tar`; write the matching `advancedConfig` slot; make the 64 MB cap configurable; `docker load` cache keyed by role.
- Commit: `feat(web): role-aware advanced image upload`.

### Task 6.2: three scaffolds
- Create: `apps/web/src/lib/server/advanced-scaffold/files/{run,grade,service}/` — run (`runner.py` runs student, writes `/output`; Dockerfile bakes inputs + GNU tar), grade (`grader.py` reads `/run-output`+`/answers`, writes `result.json`; shared `nojv_grader.py`), service (minimal HTTP server).
- Modify: `advanced-scaffold/+server.ts` to take `role`.
- Commit: `feat(web): per-role advanced scaffolds`.

### Task 6.3: problem edit UI
- Modify: the edit page + `JudgeTab`/advanced settings components — run/grade image fields, network `mode` selector, allowlist editor (when `allowlist`), service image (when `service`); reject oversized `totalTimeMs`.
- Commit: `feat(web): advancedConfig editor (run/grade/network)`.

---

## Phase 7 — rejudge / plagiarism reproducibility

### Task 7.1: snapshot advancedConfig on the submission
- Modify: `apps/worker/src/activities/judge.ts` / `packages/application/src/submission/` — at judge time write `Submission.advancedConfigSnapshot`; rejudge reads the snapshot, not the live Problem; plagiarism filters by snapshot.
- TDD: a rejudge after the Problem's images change still uses the snapshot.
- Commit: `feat: snapshot advancedConfig for reproducible advanced rejudge`.

---

## Phase 8 — Adversarial tests, real-machine smoke, docs, seed

### Task 8.1: adversarial security suite
- The six attacks from the design's Testing section: read `/answers`, reach non-allowlisted host, reach grade, symlink leak, proxy-unset escape, resource exhaustion. Commit: `test: advanced run/grade adversarial security suite`.

### Task 8.2: real-machine smoke (lesson: sandbox docker-arg bugs only surface on real runs)
- Manual runbook: build a dual-image problem per mode (`none`/`allowlist`/`service`), submit, confirm AC + isolation. Docker locally; K8s on OrbStack. Record results in the PR.

### Task 8.3: docs
- Rewrite `docs/architecture/JUDGE_PIPELINE.md` Advanced Mode section to the run/grade split. **Add the parity note:** "standard/checker/interactive verified to implement run/check separation (answers/judge code live only in the worker or a no-student container/ConfigMap); they do not share advanced's new attack surface. rejudge reads live problem state for all types by design."
- Move the design + this plan to `docs/plans/completed/` when shipped.
- Commit: `docs: rewrite advanced mode pipeline + judge-type parity note`.

### Task 8.4: seed
- Rewrite the demo `special_env` problem(s) in `packages/db/prisma/seed.ts` to dual-image run/grade; re-seed dev. Commit: `feat(db): dual-image advanced demo problem`.

---

## Risks / watch-items (from the design review)

- **Tar safety (2.1)** is the load-bearing security control — do not weaken it; verify on real machine.
- **K8s deny-all is additive (5.2)** — the relabel must land or per-submission egress silently fails closed (or, worse, open if mis-scoped). Test both that allowed egress works and that non-sidecar egress is blocked.
- **Orphan resources** — networks/Pods/NetworkPolicies/Services must be torn down in `finally`; add a sweep.
- **BusyBox vs GNU tar** in base images — the `--dereference`/special-file flags require GNU tar; bake it into the run base image and document in the scaffold.
- **Per-language run toolchain** — the run scaffold owns compiling/running the student; decide per-language vs single-toolchain when authoring Task 6.2.
