# @nojv/job-dispatch

> Temporal workflow dispatch 介面層。對外提供 `dispatchXxx()` / `queryXxx()` 高階 API。

## 職責

- 包住 `@temporalio/client`，讓 `@nojv/domain` 不用直接接 Temporal SDK
- 提供型別安全的 dispatch 函式（input 透過 `@nojv/core` schema 驗證）
- 提供 workflow status / progress 的 query helper
- 管理 Temporal client lifecycle（lazy init、close）
- **不負責**：定義 workflow 邏輯（那是 `@nojv/temporal` 的事）

> 未來方向：此 package 預計合併進 `@nojv/temporal`，移除 dispatch / workflow 之間的人造邊界。在合併前請維持當前的依賴方向（domain → job-dispatch → temporal client，不可反向）。

## 主要 API

- `src/dispatch.ts` — `dispatchSubmissionJudge` / `dispatchRejudge` / `dispatchContestLifecycle` / `dispatchAssessmentLifecycle` / `dispatchExamAutoClose` / `dispatchPlagiarismCheck`
- query：`querySubmissionStatus` / `queryRejudgeProgress` / `queryPlagiarismStatus`
- `src/client.ts` — `getClient` / `closeClient`

## 依賴

- 上游：`@nojv/core`、`@temporalio/client`
- 嚴禁依賴 `@nojv/db`、`@nojv/redis`、`@nojv/domain`、`@nojv/temporal`
- 下游：`@nojv/domain`、`apps/web`

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/job-dispatch build
pnpm -F @nojv/job-dispatch typecheck
```

## 相關文件

- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Judge Pipeline](../../docs/architecture/JUDGE_PIPELINE.md)
