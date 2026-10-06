# Getting Started

First local run: install, start backing services, prepare the database, run the
app, verify. Test setup is in [Testing Strategy](testing.md); env var reference
is in the [Deployment Guide](../operations/DEPLOYMENT.md#environment-variables).

## Key code

- `package.json` (scripts, engines), `docker-compose.yml`, `.env.example`
- `packages/db/prisma/seeds/` (seed data), `infra/docker/sandbox-runner.Dockerfile`

## 1. Prerequisites

```bash
node -v   # >= 24.18.0 < 25
pnpm -v   # 11.28.2
docker -v # daemon running
```

## 2. Install and configure

```bash
pnpm install
cp .env.example .env
```

The defaults work locally. Notes on `.env`:

| Variable                                                     | Local value / action                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`, `REDIS_URL`, `TEMPORAL_ADDRESS`              | Keep defaults (Compose services)                                                                 |
| `BETTER_AUTH_SECRET`                                         | Any random string locally; a real secret in production                                           |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | Keep (`http://localhost:9000`, `minioadmin`, `nojv`); the storage client throws at boot if unset |
| `EXECUTION_BACKEND`                                          | `docker` (production uses `kubernetes`)                                                          |
| `MAILER_MODE`, `APP_BASE_URL`                                | `sink`, `http://localhost:5173`; sink mode requires every `SMTP_*` key to be absent              |
| `SEED_ADMIN_USERNAME`/`_EMAIL`/`_PASSWORD`                   | Seeded admin credentials (default `admin` / `password123`)                                       |
| `ALLOWED_HOSTS`                                              | Vite host allowlist                                                                              |
| `GITHUB_*`, `GOOGLE_*`                                       | Optional OAuth apps                                                                              |
| `OTEL_*`, `GRAFANA_*`                                        | Optional; see [Observability Setup](observability-setup.md)                                      |

## 3. Start backing services

```bash
docker compose up -d
docker compose ps   # wait until all are healthy
```

| Service       | Port       | Notes                                                      |
| ------------- | ---------- | ---------------------------------------------------------- |
| `postgres`    | 5432       | PostgreSQL 18, app and Temporal databases                  |
| `redis`       | 6379       | Redis 8                                                    |
| `minio`       | 9000, 9001 | S3 API and console; `minio-init` creates the `nojv` bucket |
| `temporal`    | 7233       | `temporalio/auto-setup`; first boot can take 30s+          |
| `temporal-ui` | 8080       | Workflow UI                                                |

Compose runs only dependencies; web and worker run from source. Compose is not a deployment path (OPS-01).

## 4. Prepare the database

```bash
pnpm db:generate
pnpm build
pnpm db:deploy
pnpm db:seed:validate
pnpm db:seed
```

The seed creates the admin (from `SEED_ADMIN_*`), `teacher`, `ta-student`, `student` and `new-student` (password `password123`), demo students enrolled in the "Operating Systems Lab" course, problems, contests and assessments. Course activities use teacher-owned private copies (`<problem>-course`, forked from the public problem) shared through the course problem library, as the app does when a public problem is added to an activity, so the seeded TA can co-edit them; sample subtasks are worth 0 points. The `special_env` demo problem references optional `registry.nojv.tw/demo/*` images published manually with `pnpm demo-advanced:push`.

## 5. Build the sandbox image

```bash
pnpm sandbox:build   # nojv-sandbox:local
```

Rebuild after changing `apps/sandbox-runner` or `infra/docker/sandbox-runner.Dockerfile`.

## 6. Run

```bash
pnpm dev
```

Starts web at <http://localhost:5173> and the worker with `WORKER_MODE=all` (judge, judge-state, judge-cleanup and platform queues, plus test-judge once the [local test judge](#run-the-test-judge-locally) is set up).

## 7. Verify

1. <http://localhost:5173> shows the landing page.
2. <http://localhost:8080> shows the `default` Temporal namespace.
3. Sign in at `/admin-signin` with the seeded admin (password sign-in is admin-only; `/signin` offers OAuth).
4. Submit a solution to a seeded problem; the verdict arrives and the run appears in the Temporal UI.

## Common tasks

| Task                | Command                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| Reset database      | `pnpm --filter @nojv/db exec prisma migrate reset --force && pnpm db:seed` |
| After schema change | `pnpm db:migrate && pnpm build`                                            |
| Local CI gate       | `pnpm ci:verify` (scope in [Testing Strategy](testing.md#commands))        |
| Run tests           | See [Testing Strategy](testing.md)                                         |

### Exercise IP-based exam rules

Outside production, `getClientIp` reads the `x-dev-ip` header first, then the socket address; production accepts only `CF-Connecting-IP` (SEC-09).

```bash
curl -H "x-dev-ip: 10.1.2.3" http://localhost:5173/exams/<examId>
```

### Run the test judge locally

Checker and interactive Test need the WASM-OJ runtime that the worker image bundles. Standard Test and Submit work without it. Build the native runtime from the forge tag the worker image pins (`WASM_OJ_FORGE_TAG` in `infra/docker/worker.Dockerfile`; needs a Rust toolchain) and install the server toolchains from the image's lockfile:

```bash
git clone --depth 1 --branch v0.2.3 https://github.com/wasm-oj/forge ~/src/wasm-oj-forge
cargo build --locked --release --manifest-path ~/src/wasm-oj-forge/crates/runtime-core/Cargo.toml \
  --bin wasm-oj-runner --bin wasm-oj-compiler
mkdir -p ~/.cache/nojv-wasm-oj-toolchains
cp infra/docker/wasm-oj-toolchains/package*.json ~/.cache/nojv-wasm-oj-toolchains/
npm ci --ignore-scripts --prefix ~/.cache/nojv-wasm-oj-toolchains
```

Then add to `.env` (absolute paths) and restart `pnpm dev`:

```bash
WASM_OJ_RUNTIME_DIR=/home/you/src/wasm-oj-forge/crates/runtime-core/target/release
WASM_OJ_TOOLCHAIN_DIR=/home/you/.cache/nojv-wasm-oj-toolchains
TEST_JUDGE_ENABLED=true
```

The `WORKER_MODE=all` worker then also serves `test-judge`. Seeded checker problems such as `problem_any-two-sum` show "Judged on the server" on their samples. The same two directories enable the gated runtime test ([Testing Strategy](testing.md#service-prerequisites)).

## Troubleshooting

| Problem                                          | Fix                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `vitest`/`tsc` not found                         | `pnpm install`                                                                 |
| Prisma client errors                             | `pnpm db:generate && pnpm build`                                               |
| Temporal connection refused                      | `docker compose ps`, `docker compose logs temporal`; wait for first-boot setup |
| Worker cannot reach the Docker socket (Linux)    | `sudo usermod -aG docker $USER`, then log in again                             |
| Port in use (5432, 6379, 7233, 8080, 9000, 9001) | `lsof -i :<port>`, or change the mapping in `docker-compose.yml`               |
| Mailer startup error in sink mode                | Remove every `SMTP_*` key from `.env`, including empty ones                    |
