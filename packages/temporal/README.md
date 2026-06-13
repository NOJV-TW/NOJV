# @nojv/temporal

> Temporal client、dispatch API、task queue 常數與 workflow input/output types。

## 職責

- 提供 Temporal client 單例（`getTemporalClient` / `closeTemporalClient`）
- 提供 dispatch API：`dispatchSubmissionJudge`、`dispatchRejudge`、`dispatchContestLifecycle`、`dispatchExamAutoClose`、`dispatchPlagiarismCheck`,以及對應的 workflow query helpers
- 定義 task queue 名稱（`JUDGE_TASK_QUEUE`、`PLATFORM_TASK_QUEUE`）
- 定義 dispatch input/output 與 workflow signal types

**這個 package 故意 _沒_ 依賴 `@nojv/application` 或任何 workflow / activity 程式碼** —— 那是為了避免 `domain → temporal → domain` 的循環依賴。workflow 定義與 activity 實作都放在 `apps/worker/`，由 worker 啟動時 register 給 Temporal SDK。

## 主要入口

- `src/index.ts` — 對外型別、task queue 常數、client 與 dispatch API
- `src/client.ts` — Temporal client 連線單例
- `src/dispatch.ts` — workflow dispatch / query helpers
- `src/types.ts` — workflow input / output / signal types
- `src/task-queues.ts` — task queue 名稱常數

workflow 與 activity 程式：見 `apps/worker/src/workflows/`、`apps/worker/src/activities/`。

## 依賴

- 上游：`@nojv/core`、`@temporalio/client`
- 下游：`@nojv/application`（dispatch helpers + types）、`apps/worker`（workflows + activities 自行 register）

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
