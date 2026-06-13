# @nojv/storage

> S3-compatible 物件儲存抽象層。本地用 MinIO，production 接 GCS / R2 / S3。

## 職責

- 封裝 `@aws-sdk/client-s3`，提供有意義的高階 API（upload/download/delete）
- 集中管理 storage key naming（testcase、workspace file、problem image、avatar、advanced image tarball）
- 處理大檔 streaming（advanced image tarball）
- **不負責**：DB 中的 metadata（在 `@nojv/db` repository）、權限（在 `@nojv/application`）

## 主要 API

- `src/client.ts` — `createStorageClient()`
- `src/images.ts` — `uploadProblemImage` / `uploadUserContentImage` / `deleteProblemImage` / advanced image tarball helpers
- `src/avatar.ts` — `uploadUserAvatar` / `deleteUserAvatar`
- `src/keys.ts` — `testcaseInputKey` / `testcaseOutputKey` / `workspaceFileKey` / `problemPrefix`
- `src/blobs.ts` — `putText` / `getText` / `deleteBlob` / `deleteBlobsByPrefix`

## 依賴

- 上游：`@aws-sdk/client-s3`
- 下游：`@nojv/db`（清理資源時）、`@nojv/application`、`apps/web`、`apps/worker`

## 本地開發

```bash
# 從 repo 根目錄
pnpm -F @nojv/storage build
pnpm -F @nojv/storage typecheck
```

需先啟動 MinIO（見 `docker-compose.yml`）。

## 相關文件

- [Architecture Overview](../../docs/architecture/ARCHITECTURE.md)
- [Deployment Guide](../../docs/operations/DEPLOYMENT.md)
