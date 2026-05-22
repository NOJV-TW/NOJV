# NOJV Worker

> Temporal worker process — 跑 submission judging 與 lifecycle workflows。

## 職責

- 註冊並執行 `@nojv/temporal` 定義的 workflow / activity
- 監聽多個 task queue（judge、platform、plagiarism 等）
- 在 Docker（本地）或 Kubernetes（production）中啟動 sandbox container 跑使用者程式碼
- 收集 sandbox 結果、寫回 DB、發 pub/sub 事件
- **不負責**：定義 workflow 邏輯本身（在 `@nojv/temporal`）、UI、HTTP API

## 主要入口

- `src/index.ts` — worker bootstrap，連 Temporal 並註冊 activities
- `src/services/docker-executor.ts` — 本地 Docker sandbox 啟動器
- `src/services/k8s-executor.ts` — 生產環境 Kubernetes sandbox 啟動器
- `src/health-server.ts` — health check endpoint
- task queue 註冊：見 `@nojv/temporal` 的 `task-queues.ts`

## 依賴

- 上游：`@nojv/core`、`@nojv/temporal`（workflow + activity 定義）、`@nojv/db`、`@nojv/redis`、`@nojv/storage`
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
