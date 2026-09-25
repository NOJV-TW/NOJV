# @nojv/temporal

> Temporal client、dispatch adapter 與 task queue 常數。

## 職責

- 提供 Temporal client 單例（`closeTemporalClient`）與連線設定（`temporalConnectionOptions`）
- `buildDomainOrchestrationAdapter()` 把 submission judge、rejudge、plagiarism、assignment/exam/contest lifecycle、judge execution/cleanup 與 registry GC 的 dispatch/query/reconciliation helpers 注入 `@nojv/application`
- 提供 worker 啟動時的 singleton cron workflows（`ensureSubmissionSweeper`、`ensureLifecycleReconciler`、`ensureDurableWorkProcessor`）
- 定義 task queue 名稱（`JUDGE_TASK_QUEUE`、`JUDGE_STATE_TASK_QUEUE`、`PLATFORM_TASK_QUEUE`）

**這個 package 故意 _沒_ 依賴 `@nojv/application` 或任何 workflow / activity 程式碼** —— 那是為了避免 `application → temporal → application` 的循環依賴。workflow 定義與 activity 實作都放在 `apps/worker/`，由 worker 啟動時 register 給 Temporal SDK。

## 主要入口

- `src/index.ts` — task queue 常數、client 關閉、orchestration adapter 與 worker cron helpers
- `src/client.ts` — Temporal client 連線單例
- `src/dispatch.ts` — workflow dispatch / query helpers
- `src/orchestration-adapter.ts` — 注入 `@nojv/application` 的 dispatch adapter
- `src/lifecycle-reconciliation.ts` — lifecycle workflow 的 keep/replace/terminate 判斷
- `src/task-queues.ts` — task queue 名稱常數

Workflow input/output types 定義在 `@nojv/core`（`packages/core/src/workflow-types.ts`）。

workflow 與 activity 程式：見 `apps/worker/src/workflows/`、`apps/worker/src/activities/`。

## 依賴

- 上游：`@nojv/core`、`@temporalio/client`
- 下游：`apps/web` 與 `apps/worker` 透過 `configureDomainOrchestration(buildDomainOrchestrationAdapter())` 注入 `@nojv/application`；`apps/worker` 另外自行 register workflows + activities

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/temporal build
pnpm -F @nojv/temporal typecheck
```

## 相關文件

- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Reliability Invariants](../../docs/operations/RELIABILITY.md)
