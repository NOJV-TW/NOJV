# @nojv/storage

> S3-compatible 物件儲存。本地用 MinIO，production 接 GCS / R2 / S3，只靠環境變數切換。

## 職責

- 封裝 `@aws-sdk/client-s3`：immutable、hash 驗證的物件讀寫與 storage pointer
- 集中管理 key 命名（testcase、workspace、checker / interactor、submission source / verdict detail、圖片、avatar）
- **不負責**：DB 中的 pointer 與 ownership（`@nojv/db` / `@nojv/application`）、權限（`@nojv/application`）

## 主要 API

- `src/client.ts` — `createStorageClient()`
- `src/env.ts` — `storageEnvSchema`、`getStorageEnv()`；`S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`（production 必填）、`S3_BUCKET`（預設 `nojv`）、`S3_REGION`（預設 `auto`）
- `src/object.ts` — `StorageObjectPointer`、`putImmutableObject` / `putImmutableText` / `putObjectIfAbsent`、`getVerifiedObject` / `getVerifiedText`
- `src/keys.ts` — `testcase*Key`、`workspaceFileKey`、`checkerKey`、`interactorKey`、`submission*Key`
- `src/submission.ts` — submission source plan / manifest、verdict detail
- `src/images.ts`、`src/avatar.ts` — 題目、使用者內容與遠端圖片、avatar
- `src/blobs.ts` — `getObject` / `getText` / `deleteBlob` / `deleteBlobsByPrefix` / `listByPrefix`

資料流與圖片路由見 [Architecture](../../docs/architecture/ARCHITECTURE.md#object-storage)。

## 依賴

- 上游：`@nojv/core`、`@aws-sdk/client-s3`、`zod`
- 下游：`@nojv/application`、`apps/web`（僅 `src/lib/server/storage/**`）、`apps/worker`；`@nojv/db` 僅 seed 與 `prisma/scripts/` 使用

## 本地開發

```bash
pnpm -F @nojv/storage build
pnpm -F @nojv/storage typecheck
```

需先啟動 MinIO（見 `docker-compose.yml`）。
