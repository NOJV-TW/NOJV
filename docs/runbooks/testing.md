# Testing Strategy

Where a new test belongs, how to run each layer, the destructive test database
contract, the Kubernetes suite and the judge capacity benchmark.

## Key code

- `vitest.config.ts` (projects, coverage thresholds), `tests/e2e/playwright.config.ts`
- `tests/setup/` (global setup, destructive-database guard, K8s target guard, test binaries)
- `.github/workflows/ci.yml`, `.github/workflows/nightly-sandbox.yml`
- `scripts/judge-benchmark.ts`

## Layers

Every test lives under the repo-root `tests/` tree and ends in `.test.ts` (never `.spec.ts`, never package `__tests__/`).

| Vitest project / runner | Glob                                                                                        | Scope                                               | Dependencies                         |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| `unit`                  | `tests/unit/**`                                                                             | Pure modules, schemas, isolated server/domain logic | None                                 |
| `component`             | `tests/component/**`                                                                        | Svelte component behavior in jsdom                  | None                                 |
| `integration`           | `tests/integration/**` except `judge/`, `temporal/`, `k8s/`, `storage/`; files run serially | HTTP routes, repositories, application flows, Redis | PostgreSQL, Redis, MinIO, Temporal   |
| `temporal-integration`  | `tests/integration/temporal/**`                                                             | Workflows against the SDK test servers              | Downloaded Temporal test binaries    |
| `sandbox-integration`   | `tests/integration/judge/**`                                                                | Real sandbox image isolation and judging            | Docker, `nojv-sandbox:local`         |
| `storage-conformance`   | `tests/integration/storage/**`                                                              | Unmocked `@nojv/storage` against a real S3 endpoint | `S3_CONFORMANCE=1` and an S3 backend |
| `k8s-integration`       | `tests/integration/k8s/**`                                                                  | Kubernetes backend                                  | Disposable k3d cluster               |
| Playwright              | `tests/e2e/`                                                                                | User journeys through a running app                 | Built packages and all services      |

Choosing a layer:

- Pure math, parsing or Zod logic (including in `@nojv/application`) → `tests/unit/<domain>/`.
- One component's keyboard, loading, empty or error state → `tests/component/web/`.
- Anything touching Prisma, a SvelteKit action or loader, or an HTTP route → integration, against the real database (never mock it; ENG-04 for the HTTP harness).
- A user-visible flow → E2E.
- Unit tests never need PostgreSQL, Redis or Temporal.

Coverage thresholds for `packages/{application,core}` and `apps/{worker,sandbox-runner}` are in `vitest.config.ts`. Every application mutation needs a unit test of its pure logic; every API route or form action that touches the database needs an integration test for the golden path and a likely failure.

## Commands

```bash
pnpm test:unit                # unit project
pnpm test:component           # component project
pnpm test:db:provision        # create and mark nojv_test and nojv_e2e_test
pnpm test:integration         # integration + temporal-integration + sandbox-integration
pnpm test:integration:temporal
pnpm test:integration:sandbox
pnpm test:integration:k8s     # k8s-integration (guarded)
pnpm test:integration:storage # storage-conformance (skipped unless S3_CONFORMANCE=1)
pnpm test:e2e                 # full Playwright suite
pnpm test:all                 # unit, component, integration, e2e
pnpm ci:verify                # local gate without services
```

`ci:verify` runs Prettier, the repository guards (`lint:repo`), package builds, typechecks, ESLint, test typechecks, unit and component tests. It starts no database and runs no integration, Playwright, migration-to-schema comparison, schema-doc generation or Helm rendering.

CI (`ci.yml`) additionally runs `pnpm lint:helm`, integration tests with the coverage gate, Temporal integration, the S3 conformance test against Versity (`storage-conformance` job) and a core Playwright browser smoke. The scheduled sandbox workflow (`nightly-sandbox.yml`, weekly) runs the sandbox isolation suite and the K8s suite on a k3d cluster. A green `ci:verify` proves only its own scope.

## Service prerequisites

- **Integration**: PostgreSQL, Redis, MinIO and Temporal from Compose, plus `nojv_test`. Temporal test servers download on first use and are cached in `$TMPDIR` for a day; CI pre-downloads them with `scripts/download-temporal-test-servers.sh`.
- **E2E**: run `pnpm build` first (`tests/tsconfig.e2e.json` resolves built `dist/` packages), the same services, and `nojv_e2e_test`. Playwright starts its own strict-port dev server at `http://localhost:5174`; do not start one. It runs one worker because tests share one destructive database; do not pass `--workers`.

## Destructive test databases

1. Start dependencies and provision:

   ```bash
   docker compose up -d postgres redis minio minio-init temporal
   pnpm test:db:provision
   ```

   This creates only `nojv_test` and `nojv_e2e_test` and sets the comments `NOJV_TEST_DATABASE:nojv_test` / `NOJV_TEST_DATABASE:nojv_e2e_test`. The validator never creates or repairs markers.

2. Integration:

   ```bash
   BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nojv_test \
   NOJV_DESTRUCTIVE_TEST_DATABASE=nojv_test \
   REDIS_URL=redis://127.0.0.1:6379 \
   TEMPORAL_ADDRESS=127.0.0.1:7233 \
   S3_ENDPOINT=http://127.0.0.1:9000 S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin \
   S3_BUCKET=nojv S3_REGION=us-east-1 \
   MAILER_MODE=sink APP_BASE_URL=http://localhost:5173 \
   pnpm test:integration
   ```

3. E2E:

   ```bash
   BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nojv_e2e_test \
   NOJV_DESTRUCTIVE_TEST_DATABASE=nojv_e2e_test \
   pnpm test:e2e
   ```

Contract:

- `TEST_DATABASE_URL` is the only destructive URL; `DATABASE_URL` is ignored.
- The URL must use `postgresql:`, host `127.0.0.1` or `::1`, the exact allowlisted database, and no query or fragment.
- The live connection must report the expected database name, a real server IP and port, and the exact comment marker; setup prints them as proof.
- Every `TRUNCATE` revalidates that identity in the same transaction.
- `BETTER_AUTH_SECRET` must be a test-only value of at least 32 characters (exam credential encryption).
- The integration suite loads `.env`; sink mode requires every `SMTP_*` key absent, and notification transactions validate mailer config even when no email is sent.

## Object storage conformance

The `integration` project mocks `@nojv/storage` in memory. `tests/integration/storage/s3-conformance.test.ts` is the unmocked gate for any S3 backend: atomic `If-None-Match: *` (sequential and racing), SHA-256 checksum rejection, SDK default checksums, `ContentType`, `ListObjectsV2`/`ListObjects` pagination and delimiters, `DeleteObjects`, `CopyObject`, multipart with `UploadPartCopy`, and NOJV key shapes including a key that is also another key's directory prefix. It writes under unique `conformance-<uuid>` prefixes in `S3_BUCKET` and deletes them afterwards.

`infra/docker/s3-conformance/compose.yml` runs candidate backends side by side (profiles `minio`, `versity`, `seaweedfs`; S3 on `127.0.0.1:9100/9200/9300`, a chart-shaped `registry:2` on `5100/5200/5300`). It is separate from the dev stack. CI starts only the `versity` profile (`docker compose … --profile versity run --rm versity-init`) and needs no secrets.

```bash
docker compose -f infra/docker/s3-conformance/compose.yml --profile versity up -d
S3_CONFORMANCE=1 S3_ENDPOINT=http://127.0.0.1:9200 S3_ACCESS_KEY=conformance \
  S3_SECRET_KEY=conformance-secret S3_BUCKET=nojv S3_REGION=us-east-1 \
  pnpm test:integration:storage
docker compose -f infra/docker/s3-conformance/compose.yml --profile '*' down -v
```

## Kubernetes and gVisor suite

- Guards: `REQUIRE_K8S=1`, context `k3d-nojv-judge`, a loopback API endpoint, `K8S_TEST_RUN_ID` (DNS-safe) and namespace `nojv-sandbox-test-${K8S_TEST_RUN_ID}`. Use an isolated kubeconfig; never repoint the guards at another cluster.
- `NOJV_TEST_SANDBOX_IMAGE` selects a locally built candidate image (default `nojv-sandbox:local`).
- Calico, image import and Helm policy setup follow `nightly-sandbox.yml`. Keep the k3s `--cluster-cidr` identical to the Calico IP pool (default `192.168.0.0/16`); a mismatch makes kube-proxy SNAT cross-node Service traffic and breaks source-pod ingress policy even when Pod-IP traffic works.
- gVisor evidence: install real gVisor on the disposable node ([install](https://gvisor.dev/docs/user_guide/install/), [containerd](https://gvisor.dev/docs/user_guide/containerd/quick_start/)), create RuntimeClass `gvisor` with handler `runsc`, confirm a probe container's `dmesg` reports gVisor, and run with `NOJV_TEST_RUNTIME_CLASS=gvisor`. Without it the suite uses the default runtime.
- Before deleting the cluster, inspect CRI tasks, processes and cgroups; API-object cleanup alone is not proof.

## Judge capacity benchmark

`scripts/judge-benchmark.ts` compares a baseline release with a candidate through the public submission POST and result GET APIs. It never creates accounts, edits problems, clears caches or changes cluster configuration; tokens come from env vars and are never written out, nor are response bodies or source.

### Manifest

A private JSON file matching the exported `manifestSchema`:

| Field                                              | Requirement                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                    | `1`                                                                                                         |
| `target`, `targetKind`                             | HTTP(S) origin; `isolated-test` or `shared-server`                                                          |
| `sandboxImageDigest`                               | Immutable `sha256:…` digest used by both versions                                                           |
| `backgroundServicesSha256`, `machineProfileSha256` | SHA-256 of the saved background-service configuration and node hardware/topology inventory                  |
| `dedicatedTestAccounts`                            | `true`, after verifying the accounts are dedicated test users                                               |
| `accounts`                                         | Exactly 100 distinct `{ userId, tokenEnv }`; each token must belong to that user                            |
| `fixtures`                                         | Exactly six: `short`, `cpu-heavy`, `memory-heavy`, each with 20 and 100 testcases                           |
| Each fixture                                       | Unique `id`, `workload`, `cases`, `datasetSha256`, `expectedVerdict`, and a normal submission API `payload` |
| `maintenance`                                      | Remote or shared targets: `approvalReference`, ISO UTC `startsAt`/`endsAt`, `realJudgeDrained: true`        |

Payloads use the submission schema (`problemId`, `language`, `context`, `sourceCode`/`sourceFiles`). Pin testcases and hash their canonical export, including limits and checker config; no sample-only or reference-solution submissions. Inventory hashes attest to saved operator evidence; the tool cannot verify cluster configuration.

Remote targets require HTTPS and a maintenance window covering the whole arrival schedule plus completion timeout; `shared-server` needs it even through a loopback tunnel. Stop real judge dispatch, drain real work, confirm no exam is running and use dedicated accounts before recording approval. Never label a production tunnel `isolated-test`. Verify account/token identity when provisioning test accounts.

### Collect

```bash
node --import tsx scripts/judge-benchmark.ts --help
node --import tsx scripts/judge-benchmark.ts --validate /private/benchmark-manifest.json
node --import tsx scripts/judge-benchmark.ts \
  --collect /private/benchmark-manifest.json --fixture cpu-heavy-100 \
  --load burst --cache warm --repetition 1 --revision RELEASE_COMMIT \
  --cache-evidence maintenance-record/warm-1 --output /private/burst-warm-1.json
```

1. Run one trial at a time: each fixture × `single` (one submission), `steady` (100 students over 10 minutes), `burst` (100 students over 60s) × `cold`/`warm` × repetitions 1–3 = **108 trials per version**.
2. Prepare and record cache state before each trial; `--cache` only labels it. Keep warmup, polling cadence, background workload and web/DB probes identical.
3. Wait for cleanup and a quiet judge queue between trials. `--timeout-seconds` defaults to 1800 (max 7200). Ambiguous transport failures are never resubmitted; reconcile any accepted submission and its resources before rerunning.

Results use `trialSchema`. Completion is polled once per second (included in end-to-end time); `httpLatencyMs` is request latency, not a substitute for the web probe workload.

### Enrich

Join each trial copy by submission ID with saved worker, Prometheus and runtime evidence to fill:

- Per submission: `queueMs` (Temporal queue plus admission wait) and `cpuSeconds` (sum of actual judge CPU).
- `telemetry`: `evidenceReference`, `cleanupCompletedAt` (epoch ms), `webLatencyMs`, `dbLatencyMs`, `oomCount`, `runtimeLeakCount`, `starvationCount`, `falseQueueFailureCount`, `verdictFixturesPassed` (full language/mode correctness suite). Counters cover the trial through cleanup.

Drain time ends at the later of the last verdict and verified cleanup. Preserve metric exports, collector clocks, process/cgroup inventory, fairness evidence and correctness results at `evidenceReference`. Never infer zero leaks from deleted API objects, zero OOM from free memory, queue time from the first poll, or CPU seconds from maximum testcase runtime; missing evidence stays null.

### Compare

```bash
node --import tsx scripts/judge-benchmark.ts \
  --compare /private/baseline.json --candidate /private/candidate.json \
  --output /private/comparison.json
```

Exit 0 requires 108 unique trials per side, matching fixed inputs, complete measurements, expected verdicts, zero safety failures, at least 20% median burst drain improvement for every fixture/cache pair, and at most 10% regression in single-submission and web API p95. Anything else exits 1. Reports cover drain time, throughput, queue and end-to-end p50/p95/p99, CPU seconds per submission, and web/DB latency. Output files are mode 0600 and never overwrite.

Passing is a performance gate, not deployment approval. Keep verified cleanup and measurement fixes even if the resource-strategy gate fails. Validate multi-node admission and failure behavior separately; two virtual nodes on one host do not show extra physical throughput.
