# @nojv/storage

> S3-compatible 物件儲存抽象層。本地用 MinIO，production 接 GCS / R2 / S3。

## 職責

- 封裝 `@aws-sdk/client-s3`，提供有意義的高階 API（upload/download/delete）
- 集中管理 storage key naming（testcase、workspace file、problem image、avatar）
- **不負責**：DB 中的 metadata（在 `@nojv/db` repository）、權限（在 `@nojv/application`）

## 主要 API

- `src/client.ts` — `createStorageClient()`
- `src/images.ts` — problem / user-content image 上傳、下載與 `cacheRemoteImage`
- `src/avatar.ts` — `uploadUserAvatar` / `deleteUserAvatar`
- `src/keys.ts` — `testcaseInputKey` / `testcaseOutputKey` / `workspaceFileKey` 等 versioned object key
- `src/object.ts` — 以 SHA-256 驗證的 immutable object pointer（`putImmutableObject` / `getVerifiedObject`）
- `src/submission.ts` — submission source manifest 與 verdict detail
- `src/blobs.ts` — `getText` / `deleteBlob` / `deleteBlobsByPrefix`

## 依賴

- 上游：`@aws-sdk/client-s3`
- 下游：`@nojv/db`（僅 Prisma seed）、`@nojv/application`、`apps/web`、`apps/worker`

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
