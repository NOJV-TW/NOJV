# NOJV Worker

> Temporal worker process：定義並執行 judging、lifecycle、plagiarism、durable work、registry GC 與 Test 判題（test judge）的 workflows 和 activities。

判題流程見 [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)；佇列與容量操作見 [Judge Queue runbook](../../docs/runbooks/judge-queue.md)。

## 職責

- 載入 `src/workflows/` 的 workflow 定義並註冊 `src/activities/` 的 activities；dispatch client、task queue 名稱與 workflow I/O types 來自 `@nojv/temporal`
- 監聽 task queues：`judge`（sandbox stage）、`judge-state`（判題 bookkeeping）、`judge-cleanup`（延後的 stage 清理）、`platform`（lifecycle、score effects、plagiarism、durable work、registry GC）、`test-judge`（checker / interactive 的 Test 判題與 judge program 建置）
- 透過 Docker（本地）或 Kubernetes（production）啟動 sandbox，收集結果、寫回 DB、經 Redis pub/sub 發布 verdict
- **不負責**：業務規則（在 `@nojv/application`）、UI、HTTP API

## 執行模式

`WORKER_MODE`：

| 值            | Workers                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `all`（預設） | 以下全部；`test-judge` 只在兩個 `WASM_OJ_*` 目錄都設定時啟動                                                                                        |
| `judge`       | `judge`（workflows + stage activities）、`judge-state` 與 `judge-cleanup`（各 16 slots）；K8s backend 啟動前先驗證 runtime 與 NetworkPolicy         |
| `platform`    | `platform`；啟動 submission sweeper、lifecycle reconciler、durable work processor，並執行一次 stale sweep 與 SE recovery                            |
| `test`        | `test-judge`（`TEST_JUDGE_SLOTS` 個 WASM-OJ engine，一個 slot 一個）；必須設定 `WASM_OJ_RUNTIME_DIR` 與 `WASM_OJ_TOOLCHAIN_DIR`，不建立 sandbox Job |

## 主要入口

- `src/index.ts` — bootstrap（OTel 必須最先載入）
- `src/worker-app.ts` — Temporal workers、slot tuner、startup probes、graceful shutdown
- `src/env.ts` — env schema（`EXECUTION_BACKEND` = `docker` | `kubernetes`）
- `src/health-server.ts` — `/livez`、`/readyz`、`/healthz`
- `src/workflows/` — workflow 定義（`durable-judge.ts` 為判題主流程）
- `src/activities/` — activity handlers；`judge-bundle.ts` / `platform-bundle.ts` / `test-judge-bundle.ts` 決定各 queue 註冊的 activities
- `src/test-judge/` — WASM-OJ engine pool（`runtime.ts`）與 judge program 建置快取（`judge-program.ts`）
- `src/sandbox/shared/` — executor factory/owner、sandbox plan、stage payload builders、advanced meta/result contract、log parsing、result mapping、phase metrics
- `src/sandbox/docker/` — Docker executors、hardened args builder、network、resource sweeper
- `src/sandbox/kubernetes/` — standard/interactive/advanced executors、Job manifests、payload shards、watch、admission、cleanup、startup probes

## 主要環境變數

| 變數                                                                                                                              | 用途                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_CONCURRENCY`, `WORKER_MIN_CONCURRENCY`                                                                                    | judge activity slots；設定 min 時依節點負載調整 slot 數                                                                                                               |
| `SANDBOX_IMAGE`                                                                                                                   | sandbox-runner image                                                                                                                                                  |
| `SANDBOX_MEMORY_HEADROOM_MB`, `SANDBOX_MAX_MEMORY_MB`                                                                             | container memory headroom 與上限（預設 64 / 1536）                                                                                                                    |
| `SANDBOX_CPU_LIMIT`, `SANDBOX_MEMORY_MB`, `SANDBOX_PIDS_LIMIT`                                                                    | Docker backend 限制                                                                                                                                                   |
| `K8S_NAMESPACE`, `K8S_CPU_*`, `K8S_MEMORY_*`, `K8S_RUN_PARALLELISM`, `K8S_RUNTIME_CLASS_NAME` (`gvisor`), `K8S_IMAGE_PULL_SECRET` | Kubernetes backend                                                                                                                                                    |
| `WASM_OJ_RUNTIME_DIR`, `WASM_OJ_TOOLCHAIN_DIR`, `WASM_OJ_CACHE_DIR`, `TEST_JUDGE_SLOTS`                                           | Test judge 的 WASM-OJ runtime、toolchains、engine cache 與 slot 數（本機設定見 [Getting Started](../../docs/runbooks/getting-started.md#run-the-test-judge-locally)） |

完整部署值見 [Deployment Guide](../../docs/operations/DEPLOYMENT.md)。

## 依賴

- 上游：`@nojv/application`、`@nojv/core`、`@nojv/db`、`@nojv/mailer`、`@nojv/redis`、`@nojv/sandbox-docker`、`@nojv/storage`、`@nojv/temporal`
- 下游：Temporal server、Docker daemon 或 Kubernetes API、sandbox-runner container
- Verdict 經 Redis pub/sub 推送到 `apps/web` SSE

## 本地開發

```bash
pnpm -F @nojv/worker dev          # node --watch（tsx），讀 repo 根目錄 .env
pnpm -F @nojv/worker build        # esbuild bundle（dist/index.js + workflows）
pnpm -F @nojv/worker typecheck
```

需先啟動 Temporal server（見 `docker-compose.yml`）。

## 相關文件

- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Reliability Invariants](../../docs/operations/RELIABILITY.md)
- [Deployment Guide](../../docs/operations/DEPLOYMENT.md)
