# Problem Image Upload Design

**Date:** 2026-04-06
**Status:** Approved

## Overview

讓題目編輯者可以拖放或貼上圖片到 statement、inputFormat、outputFormat 三個 textarea，自動上傳並插入 Markdown 圖片語法。

## Architecture

```
拖放/貼上圖片到 textarea
       ↓
前端攔截 drop/paste 事件
       ↓
POST /api/problems/[id]/images  (multipart/form-data)
       ↓
後端驗證權限 + 檔案類型 + 大小
       ↓
@aws-sdk/client-s3 上傳到 bucket
路徑: problems/{problemId}/images/{uuid}.{ext}
       ↓
回傳 public URL
       ↓
前端在游標位置插入 ![](url)
```

## Storage

- S3-compatible API（`@aws-sdk/client-s3`）
- Local: MinIO（Docker 容器）
- Production: GCS S3-compatible / Cloudflare R2 / AWS S3，改 env 即可
- `forcePathStyle: true` 讓 MinIO 正常運作
- 圖片路徑: `problems/{problemId}/images/{uuid}.{ext}`

## Constraints

- 檔案類型: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- 單檔上限: 5MB
- 每題上限: 20 張（初版不擋，之後再加）

## Changes

| 層 | 改動 |
|---|------|
| infra | `docker-compose.yml` 加 MinIO + init 容器 |
| packages | 新建 `@nojv/storage` — S3 client 初始化 + upload/delete |
| API | 新增 `apps/web/src/routes/api/problems/[id]/images/+server.ts` |
| 前端 | 新增 `ImageDropZone.svelte`，取代 BasicInfoTab 三個 textarea |
| Schema | 不改 — 圖片 URL 嵌在 markdown 文字裡 |

## Package: `@nojv/storage`

```typescript
// packages/storage/src/client.ts
import { S3Client } from '@aws-sdk/client-s3';

export function createStorageClient() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle: true,
  });
}
```

```typescript
// packages/storage/src/images.ts
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const BUCKET = process.env.S3_BUCKET ?? 'nojv';

export async function uploadProblemImage(
  client: S3Client,
  problemId: string,
  file: Buffer,
  mimeType: string,
) {
  const ext = mimeType.split('/')[1];
  const key = `problems/${problemId}/images/${randomUUID()}.${ext}`;

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: file,
    ContentType: mimeType,
  }));

  const baseUrl = process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT;
  return `${baseUrl}/${BUCKET}/${key}`;
}
```

## API Endpoint

```typescript
// apps/web/src/routes/api/problems/[id]/images/+server.ts
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST({ params, request, locals }) {
  // 1. 驗證登入 + 題目編輯權限 (getActorContext)
  // 2. 解析 formData，取得 image file
  // 3. 驗證 type + size
  // 4. S3 上傳，回傳 { url }
}
```

## Frontend: `ImageDropZone.svelte`

- 包裝元件，內含 `<textarea>`
- 攔截 `drop` + `paste` 事件
- 上傳後在游標位置插入 `![filename](url)`
- 上傳中顯示遮罩提示
- 取代 BasicInfoTab 中 statement、inputFormat、outputFormat 三個 textarea

## Docker Compose

```yaml
minio:
  image: minio/minio
  ports:
    - "9000:9000"
    - "9001:9001"
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
  volumes:
    - minio-data:/data

minio-init:
  image: minio/mc
  depends_on:
    - minio
  entrypoint: >
    sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/nojv &&
      mc anonymous set download local/nojv/problems
    "
```

## Environment Variables

```bash
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=nojv
# S3_PUBLIC_URL=https://cdn.example.com  # 可選，production 指向 CDN
# S3_REGION=auto                          # 可選，預設 auto
```
