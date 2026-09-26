# @nojv/temporal

> Temporal client、workflow start/query helpers、task queue 常數，以及 `@nojv/application` orchestration port 的 adapter。

## 職責

- Temporal client 單例與連線設定（`getTemporalClient`、`closeTemporalClient`、`temporalConnectionOptions`）
- workflow 啟動、查詢、取消與 lifecycle timer reconciliation（`dispatch.ts`）
- `buildDomainOrchestrationAdapter()`：web 與 worker 啟動時交給 `configureDomainOrchestration()`
- **不含** workflow 定義與 activity 實作（在 `apps/worker/src/{workflows,activities}/`），也不 import `@nojv/application`；workflow input/output 型別在 `@nojv/core`

Workflow、queue 與 workflow ID 一覽見 [Architecture](../../docs/architecture/ARCHITECTURE.md#temporal-orchestration)。

## 主要入口

- `src/index.ts` — 對外 API
- `src/task-queues.ts` — `JUDGE_TASK_QUEUE`、`JUDGE_STATE_TASK_QUEUE`、`PLATFORM_TASK_QUEUE`
- `src/dispatch.ts` — `dispatchJudgeExecution`、`dispatchJudgeCleanup`、`ensure/replace/cancel{ContestLifecycle,ExamAutoClose,AssignmentDueSoon}`、`dispatchPlagiarismCheck`、`dispatchRegistryGarbageCollect`、cron singleton `ensure*`、judge workflow 的 `describeSubmissionJudge` / `terminateSubmissionJudge`
- `src/lifecycle-reconciliation.ts` — 以 `scheduleRevision` / `timerFingerprint` 決定 keep / terminate / start
- `src/orchestration-adapter.ts` — `DomainOrchestrationAdapter` 實作（含 `probeTemporal`）
- `src/client.ts`、`src/connection-config.ts` — `TEMPORAL_ADDRESS`、`TEMPORAL_NAMESPACE`、`TEMPORAL_API_KEY`、`TEMPORAL_TLS`、`TEMPORAL_CLIENT_CERT_PATH`、`TEMPORAL_CLIENT_KEY_PATH`、`TEMPORAL_SERVER_NAME`

## 依賴

- 上游：`@nojv/core`、`@temporalio/client`
- 下游：`apps/web`（僅 `src/lib/server/domain-orchestration.ts`）、`apps/worker`

## 本地開發

```bash
pnpm -F @nojv/temporal build
pnpm -F @nojv/temporal typecheck
```
