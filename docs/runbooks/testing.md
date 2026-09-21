# Testing Strategy

How tests are organized in NOJV, where new tests belong, and how to run them.

## Three Layers

| Layer           | Scope                                                          | Real dependencies?                         | Location                         |
| --------------- | -------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| **Unit**        | One pure function, one Zod schema, one small module            | No — mock or skip                          | `tests/unit/` (repo root)        |
| **Integration** | Cross-package paths, repository + DB, Redis, Temporal test env | Yes — uses real test DB / Redis / Temporal | `tests/integration/` (repo root) |
| **E2E**         | Full user journey through SvelteKit + worker + sandbox         | Yes — runs against a booted system         | `tests/e2e/` (Playwright)        |

## Decision Flow: Where Does My New Test Go?

```
Does the code under test live in exactly one package and have no I/O?
├── Yes → Unit test in tests/unit/
└── No
    ├── Crosses packages OR needs real DB/Redis/Temporal?
    │   └── Yes → tests/integration/
    └── Drives the UI through the browser?
        └── Yes → tests/e2e/
```

Rules of thumb:

- A repository function that hits Prisma → integration test (real DB).
- A domain function that does only math / parsing / Zod work → unit test in `tests/unit/`.
- A SvelteKit action or `+page.server.ts` loader → integration test (it touches the auth + DB stack).
- A new UI flow that the user sees → E2E.

## File Naming

- Always `.test.ts`. Never `.spec.ts` — the repo has zero `.spec.ts` files and we keep it that way.
- All tests live under the repo-root `tests/` tree: `tests/unit/`, `tests/integration/`, and `tests/e2e/`. The Vitest projects are wired to those exact globs in `vitest.config.ts`.

## Commands

```bash
pnpm test:unit          # Vitest unit tests across all packages and apps
pnpm test:db:provision  # Create and safety-mark the two destructive test databases
pnpm test:integration   # Vitest integration tests (needs explicit test DB guard variables)
pnpm test:e2e           # Playwright E2E on port 5174 (local only; not part of CI)
pnpm ci:verify          # Fast local gate — no PG/Redis needed (see below for what it does NOT cover)
```

`ci:verify` runs the dependency-free subset only: `format` + the `lint:*` guards + `db:generate` + `turbo run build typecheck lint` + `typecheck:tests` + `test:unit`. It deliberately does **not** stand up Postgres or Redis, so it does **not** run: integration tests, the coverage gate (`pnpm test:coverage`), the migration schema-drift check (`prisma migrate diff --exit-code`), or `helm lint`. Those run only in CI (`.github/workflows/ci.yml`), which provisions PG + Redis first. A green `ci:verify` locally is necessary but not sufficient — CI is the source of truth.

Turbo task wiring lives in `turbo.json`. `test:unit` does not depend on `build` — unit tests should run fast and in isolation.

## Setup Prerequisites

- **Unit**: none. `pnpm install` is enough.
- **Integration**: a running PostgreSQL, Redis, and Temporal, plus the explicitly provisioned `nojv_test` database.
- **E2E**: run `pnpm build` first (`tests/tsconfig.e2e.json` resolves built workspace packages at runtime; test typechecking uses source aliases), then start the same services, plus the explicitly provisioned `nojv_e2e_test` database. Playwright starts its own strict-port web server on `127.0.0.1:5174`; do not start one manually.

E2E tests intentionally run with one Playwright worker because they share the single destructive database and some lifecycle cases mutate seeded rows. Do not override this with `--workers`.

Global Vitest setup (test users, seeded DB state) is in `tests/setup/`.

### Provision destructive test databases

Start the local dependencies and explicitly create both allowlisted databases with their safety markers:

```bash
docker compose up -d postgres redis temporal
pnpm test:db:provision
```

`test:db:provision` creates only `nojv_test` and `nojv_e2e_test`, then assigns the exact database comments `NOJV_TEST_DATABASE:nojv_test` and `NOJV_TEST_DATABASE:nojv_e2e_test`. The test safety validator never creates or repairs those markers. A missing or incorrect marker is a hard failure.

Run integration tests with the integration database named in both required variables:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nojv_test \
NOJV_DESTRUCTIVE_TEST_DATABASE=nojv_test \
MAILER_MODE=sink APP_BASE_URL=http://localhost:5173 \
pnpm test:integration
```

Sink mode requires all `SMTP_*` keys to be absent, including empty values. The
integration suite loads `.env`; keep its service configuration aligned with
`.env.example`. Notification transactions validate mailer configuration when
creating delivery work, even when the test does not send email.

Run Playwright against the separate E2E database:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nojv_e2e_test \
NOJV_DESTRUCTIVE_TEST_DATABASE=nojv_e2e_test \
pnpm test:e2e
```

The destructive-test contract is deliberately strict:

- `TEST_DATABASE_URL` is the sole source of the destructive database URL; `DATABASE_URL` is ignored.
- The URL must use `postgresql:`, literal host `127.0.0.1` or `::1`, the exact allowlisted database path, and no query string or fragment.
- The live connection must report the expected database name, a real server IP and port, and the exact database comment marker.
- Every `TRUNCATE` revalidates that live identity inside the same transaction before deleting data.
- Successful setup prints the validated database, server address, port, and marker as proof.

## What NOT to Do

- Don't mock the database for integration tests. Use the real test DB. We've been burned before — see `MEMORY.md` history on mocked-migration drift.
- Don't co-locate tests next to the code in a package `__tests__/` folder. Every test lives under the repo-root `tests/` tree; the Vitest globs won't pick up anything outside it.
- Don't put DB/Redis/Temporal-dependent tests under `tests/unit/`. `test:unit` must stay fast — those belong in `tests/integration/`.

## Coverage Targets

We don't enforce a coverage percentage. The bar is: every domain mutation has a unit test for its pure logic, and every API/form action that touches DB has an integration test for the golden path plus the one most likely failure case.

## Local Kubernetes and gVisor

The K8s suite requires `REQUIRE_K8S=1`, context `k3d-nojv-judge`, a loopback
API endpoint, and namespace `nojv-sandbox-test-${K8S_TEST_RUN_ID}`. Use an
isolated kubeconfig and cluster; do not repoint these guards at another cluster.
The nightly sandbox workflow contains the Calico, image-import and Helm policy
setup. `NOJV_TEST_SANDBOX_IMAGE` selects the locally built candidate image without
overwriting a shared image tag.

To include prepared-artifact tests, install real gVisor in that disposable node
following the [installation guide](https://gvisor.dev/docs/user_guide/install/)
and [containerd setup](https://gvisor.dev/docs/user_guide/containerd/quick_start/).
Create RuntimeClass `gvisor` with handler `runsc`, and verify a probe container's
`dmesg` reports gVisor before running:

```bash
KUBECONFIG=/private/test-kubeconfig REQUIRE_K8S=1 \
K8S_TEST_RUN_ID=capacity-local \
K8S_TEST_NAMESPACE=nojv-sandbox-test-capacity-local \
NOJV_TEST_SANDBOX_IMAGE=nojv-sandbox:judge-capacity \
NOJV_TEST_RUNTIME_CLASS=gvisor pnpm test:integration:k8s
```

Without the runtime selector, the existing backend suite uses the default
runtime and the prepared-artifact tests are skipped; this is not gVisor evidence.
The prepared tests run C++ standard/checker submissions across waves, attempt
artifact writes, check scratch isolation, count compile Jobs and verify owned API
resources disappear. Also inspect the dedicated node's CRI tasks, processes and
cgroups before deleting the test cluster: API-object cleanup alone is insufficient.

## Judge Capacity Benchmark

Use [`scripts/judge-benchmark.ts`](../../scripts/judge-benchmark.ts) to record the
existing release before changing its execution policy, then repeat against the
candidate. The collector uses the existing submission POST and result GET APIs;
it never creates accounts, modifies problems, clears caches, or changes cluster
configuration. API tokens are read from environment variables and are excluded
from output. Submission response bodies and student source are not logged.

Prepare a private JSON manifest matching the exported `manifestSchema`:

| Field                                              | Required value                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                    | `1`                                                                                                                   |
| `target`, `targetKind`                             | HTTP(S) origin; `isolated-test` or `shared-server`                                                                    |
| `sandboxImageDigest`                               | Actual immutable `sha256:…` digest used by both versions                                                              |
| `backgroundServicesSha256`, `machineProfileSha256` | SHA-256 of saved background-service configuration and node hardware/topology inventory                                |
| `dedicatedTestAccounts`                            | `true`, after verifying the accounts are dedicated test users                                                         |
| `accounts`                                         | Exactly 100 distinct `{ userId, tokenEnv }` entries; each token must belong to that user                              |
| `fixtures`                                         | Exactly six fixtures: `short`, `cpu-heavy`, `memory-heavy`, each with 20 and 100 testcases                            |
| Each fixture                                       | Unique `id`, `workload`, `cases`, `datasetSha256`, `expectedVerdict`, and a normal full-submission API `payload`      |
| `maintenance`                                      | For remote or shared targets: approved `approvalReference`, ISO UTC `startsAt`/`endsAt`, and `realJudgeDrained: true` |

Fixture payloads use the existing submission schema (`problemId`, `language`,
`context`, `sourceCode`/`sourceFiles`). Pin the problem testcases and hash their
canonical exported data, including limits and checker configuration. Do not use
sample-only runs or reference-solution submissions. The collector additionally
hashes the source payload, expected verdict, dataset digest, sandbox image,
background services and machine profile to detect comparison drift. These
inventory hashes attest to saved operator evidence; the tool does not discover
or verify Kubernetes configuration through the public submission API.

Remote targets require HTTPS and a recorded maintenance window long enough for
the entire arrival schedule plus completion timeout. `shared-server` also
requires this window through a loopback tunnel. Stop real judge dispatch, drain
real workloads, confirm no exam is running, and use dedicated accounts/data
before recording that authorization. Do not describe a production tunnel as an
isolated test target. Account IDs and token identities must be verified during
test-account provisioning; distinct tokens alone do not prove distinct users.

```bash
node --import tsx scripts/judge-benchmark.ts --help
node --import tsx scripts/judge-benchmark.ts --validate /private/benchmark-manifest.json
node --import tsx scripts/judge-benchmark.ts \
  --collect /private/benchmark-manifest.json --fixture cpu-heavy-100 \
  --load burst --cache warm --repetition 1 --revision RELEASE_COMMIT \
  --cache-evidence maintenance-record/warm-1 --output /private/burst-warm-1.json
```

Run one trial at a time. Each fixture needs `single` (one submission), `steady`
(100 distinct students over ten minutes), and `burst` (100 distinct students
over 60 seconds), separately `cold` and `warm`, with repetitions 1–3: **108
trials per version**. Prepare and record the cache state before each trial;
`--cache` labels the evidence and does not reset images or operating-system
caches. Keep the warmup procedure, polling cadence, background service workload,
and web/DB probes identical. Wait for cleanup and a quiet judge queue between
trials. The completion timeout defaults to 1,800 seconds per submission and can
be set with `--timeout-seconds` (at most 7,200). Requests are never automatically
resubmitted after an ambiguous transport failure. Reconcile any accepted
submission and its resources before rerunning a failed trial.

The result file uses `trialSchema`. HTTP completion is observed by polling once
per second, so end-to-end measurements include that observation delay. The tool
records request latency separately as `httpLatencyMs`; this is not a substitute
for the fixed web API probe workload. It deliberately leaves the following
fields incomplete until joined to saved worker/Prometheus/runtime evidence:

- Per submission: `queueMs` (Temporal queue plus admission wait) and
  `cpuSeconds` (sum of actual judge CPU usage, not maximum testcase wall time).
- `telemetry`: `evidenceReference`, `cleanupCompletedAt` (Unix epoch milliseconds),
  `webLatencyMs`, `dbLatencyMs`, `oomCount`,
  `runtimeLeakCount`, `starvationCount`, `falseQueueFailureCount`, and
  `verdictFixturesPassed`. Latencies are raw millisecond samples; counters cover
  the entire trial through cleanup. The verdict assertion refers to the full
  supported-language/mode correctness suite, not only these performance inputs.

Drain time ends at the later of the last observed verdict and verified runtime
cleanup. It remains unavailable until cleanup evidence has been supplied.

Join by submission ID using a copy of each immutable raw trial. Preserve the
source metric exports, collector clocks, runtime process/cgroup inventory,
queue fairness evidence, and correctness-suite results at `evidenceReference`.
Do not infer zero leaks from deleted Kubernetes API objects, zero OOM from free
host memory, queue duration from first polling status, or CPU seconds from the
submission's maximum testcase runtime. Missing evidence must remain null.

Combine enriched trial objects into baseline and candidate JSON arrays, then:

```bash
node --import tsx scripts/judge-benchmark.ts \
  --compare /private/baseline.json --candidate /private/candidate.json \
  --output /private/comparison.json
```

Exit status 0 requires all 108 unique trials on each side, matching fixed inputs,
complete measurements, expected verdicts, zero recorded safety failures, at
least 20% median burst drain improvement for **each** fixture/cache combination,
and no greater than 10% single-submission or web API p95 regression. Missing
trials, rejected arrivals, incomplete telemetry or failed gates return status 1.
Reports include drain time, throughput, queue/end-to-end p50/p95/p99, CPU seconds
per submission, and web/DB latency distributions. Output files are created with
mode 0600 and existing files are never overwritten.

This comparison is a performance gate, not deployment authorization. Retain
verified cleanup/measurement fixes if the resource-strategy gate fails. Validate
multi-node admission and failure behavior separately; two virtual nodes on one
physical host do not demonstrate additional physical throughput.

## Related Docs

- [Reliability Invariants](../operations/RELIABILITY.md) — what must never break
- [Quality Ledger](../operations/QUALITY_SCORE.md) — known tech debt
- [Getting Started](getting-started.md) — first-time local dev setup
