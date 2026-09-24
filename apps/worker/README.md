# NOJV Worker

> Temporal worker process — 跑 submission judging 與 lifecycle workflows。

## 職責

- 從 `src/workflows/` 載入 workflow、從 `src/activities/` 註冊 activity；這些程式依賴 `@nojv/temporal` 提供的 queues、型別與 dispatch/query client API
- 監聽多個 task queue（judge、platform、plagiarism 等）
- 在 Docker（本地）或 Kubernetes（production）中啟動 sandbox container 跑使用者程式碼
- 收集 sandbox 結果、寫回 DB、發 pub/sub 事件
- **不負責**：定義 workflow 邏輯本身（在 `@nojv/temporal`）、UI、HTTP API

## 主要入口

- `src/index.ts` — worker bootstrap，連 Temporal 並註冊 activities
- `src/sandbox/shared/` — contracts, planning, parsing, and result mapping shared by both backends
- `src/sandbox/docker/` — Docker execution, container/network lifecycle, and resource cleanup
- `src/sandbox/kubernetes/executor.ts` — coordinates Kubernetes execution paths
- `src/sandbox/kubernetes/resources.ts` — builds Jobs, Pods, PVCs and payload maps; checks requested capacity
- `src/sandbox/kubernetes/job-watch.ts` and `job-state.ts` — observes execution and interprets pod/job state
- `src/sandbox/kubernetes/errors.ts` and `admission.ts` — classifies execution and admission failures
- `src/sandbox/kubernetes/resource-cleanup.ts` — owns Kubernetes resource teardown and reconciliation
- `src/sandbox/kubernetes/advanced*.ts`, `job-manifests.ts`, `pod-spec.ts` — advanced topology, shared manifests and security defaults
- Backend selection and ownership live in `src/sandbox/shared/executor-factory.ts` and `executor-owner.ts`
- `src/activities/` — workflow activity handlers and application calls
- `src/workflows/` — workflow definitions loaded by the worker
- `src/health-server.ts` — health check endpoint
- task queue 註冊：見 `@nojv/temporal` 的 `task-queues.ts`

## 依賴

- 上游：`@nojv/application`、`@nojv/core`、`@nojv/db`、`@nojv/mailer`、`@nojv/redis`、`@nojv/sandbox-docker`、`@nojv/storage`、`@nojv/temporal`
- 下游：Temporal server、Docker daemon / Kubernetes API、sandbox container
- 領取結果者：經由 Redis pub/sub 推送到 `@nojv/web` SSE

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/worker dev          # tsx watch
pnpm -F @nojv/worker build        # esbuild bundle
pnpm -F @nojv/worker typecheck
```

需先啟動 Temporal server（見 `docker-compose.yml`）。

## 相關文件

- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Reliability Invariants](../../docs/operations/RELIABILITY.md)
- [Deployment Guide](../../docs/operations/DEPLOYMENT.md)
