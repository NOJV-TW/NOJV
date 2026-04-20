# Testcase Blob Storage Migration Design

**Date:** 2026-04-13
**Status:** Approved

## Motivation

兩個問題合併處理：

1. **Testcase 相關檔案目前以字串存在 Postgres**（`Testcase.input`、`Testcase.output`、`Testcase.inputFiles`、`ProblemWorkspaceFile.content`），不符合「檔案應存物件儲存」的直覺。大 row 讓 Prisma query 成本飆升、backup 膨脹、編輯頁 payload 肥。
2. **MinIO 上游 repo 已於 2026-02-13 archived**（`minio/minio` README：THIS REPOSITORY IS NO LONGER MAINTAINED）。Production 本來就走 GCS/R2，但 local dev 的 `docker-compose` 還綁在 MinIO 上，未來 image 不再發布。

Production 完全走 `@nojv/storage` 抽象層（S3-compatible API），底層從 MinIO 換到任何 S3 相容實作都是零程式碼代價，所以這個設計把兩件事一起做。

## Scope

一次搬遷三個模型的內容欄位：

- `Testcase.input` → S3
- `Testcase.output` → S3
- `Testcase.inputFiles` (`Json { filename: content }`) → S3（每個 file 一個 object）
- `ProblemWorkspaceFile.content` → S3

Out of scope：題目敘述、markdown 圖片、advanced mode docker tarball — 這些已經在 S3。

## Data Strategy

**不保留舊資料，wipe + re-seed。** 沒有 production user data 要保。新 Prisma migration 直接 drop 舊欄位、add 新 key 欄位，配合 seed script 重建。零 backfill 程式碼、零 dual-write、零停機考量。

## Schema Changes

```prisma
model Testcase {
  id            String      @id @default(cuid())
  testcaseSetId String
  ordinal       Int
  inputKey      String                      // 取代 input   @db.Text
  outputKey     String?                     // 取代 output  @db.Text
  inputFileKeys Json?                       // 取代 inputFiles — 結構改為 { filename: s3Key }
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  testcaseSet   TestcaseSet @relation(...)
}

model ProblemWorkspaceFile {
  id         String @id @default(cuid())
  // ...
  contentKey String    // 取代 content @db.Text
  // ...
}
```

**刪除**（必須，不留 legacy）：`Testcase.input`、`Testcase.output`、`Testcase.inputFiles`、`ProblemWorkspaceFile.content`。

**為何存 key 而不是靠 ID 推導**：key 由 row ID 決定是事實，但把字串存進 DB 讓 row 能自我描述「我的 blob 在哪」，對 debug + 未來換 key scheme 都有彈性。代價只是 3 個新欄位。

## Key Layout（row-ID stable，overwrite on update）

```
problems/{problemId}/testcases/{testcaseId}/input
problems/{problemId}/testcases/{testcaseId}/output
problems/{problemId}/testcases/{testcaseId}/files/{filename}
problems/{problemId}/workspace/{workspaceFileId}
```

- Row ID 一對一 blob：Prisma cascade delete 的對應 S3 清理直接走 prefix
- 不做 content-addressed (sha256)：OJ testcase 幾乎不跨題重用，dedup 無價值、GC reference counting 反而是負擔
- 不做版本 ULID：沒人要求歷史版本，YAGNI

## `@nojv/storage` 擴充

新增兩個模組，全部 key 字串集中在 `keys.ts`：

```ts
// packages/storage/src/keys.ts
export const testcaseInputKey = (problemId: string, testcaseId: string) =>
  `problems/${problemId}/testcases/${testcaseId}/input`;
export const testcaseOutputKey = (problemId: string, testcaseId: string) =>
  `problems/${problemId}/testcases/${testcaseId}/output`;
export const testcaseInputFileKey = (problemId: string, testcaseId: string, filename: string) =>
  `problems/${problemId}/testcases/${testcaseId}/files/${filename}`;
export const workspaceFileKey = (problemId: string, fileId: string) =>
  `problems/${problemId}/workspace/${fileId}`;
export const problemPrefix = (problemId: string) => `problems/${problemId}/`;

// packages/storage/src/blobs.ts
export async function putText(client: S3Client, key: string, content: string): Promise<void>;
export async function getText(client: S3Client, key: string): Promise<string>;
export async function deleteBlob(client: S3Client, key: string): Promise<void>;
export async function deleteBlobsByPrefix(client: S3Client, prefix: string): Promise<void>;
```

## Write Flow（S3 first，然後單一 DB INSERT）

反模式不可接受：**不要**把 S3 upload 包在 Prisma `$transaction()` 裡 — 跨網路 IO 持有 DB connection 會毒害 pool。

```ts
// 在 packages/domain/src/problem/mutations.ts 的 createTestcase
import { createId } from "@paralleldrive/cuid2"; // 或 Prisma 內建的 cuid generator

const id = createId();
const inputKey = testcaseInputKey(problemId, id);
const outputKey = output !== undefined ? testcaseOutputKey(problemId, id) : null;

// 1. S3 put（平行）
await Promise.all([
  putText(storage, inputKey, input),
  output !== undefined ? putText(storage, outputKey!, output) : Promise.resolve(),
  ...Object.entries(inputFiles ?? {}).map(([name, content]) =>
    putText(storage, testcaseInputFileKey(problemId, id, name), content),
  ),
]);

// 2. 單一 INSERT（DB）
await prisma.testcase.create({
  data: {
    id,
    testcaseSetId,
    ordinal,
    inputKey,
    outputKey,
    inputFileKeys:
      inputFiles && Object.keys(inputFiles).length > 0
        ? Object.fromEntries(
            Object.keys(inputFiles).map((name) => [
              name,
              testcaseInputFileKey(problemId, id, name),
            ]),
          )
        : null,
  },
});
```

**失敗矩陣**：

| 狀況           | S3  | DB  | 結果                                                               |
| -------------- | --- | --- | ------------------------------------------------------------------ |
| S3 失敗        | ✗   | —   | 拋錯，零副作用                                                     |
| S3 OK，DB 失敗 | ✓   | ✗   | S3 orphan；下次重試用新 ID 不會撞 key，orphan 永遠孤立（無人指向） |
| 都 OK          | ✓   | ✓   | 正常                                                               |

Orphan S3 object 的代價 = 幾 KB 儲存費，可容忍。

**Edit 情境**：`inputKey` 穩定不變，純 content 編輯只需 `putText` 覆寫 S3，**不需要**碰 DB。同時改 metadata + content 時順序仍是「S3 先行，然後 DB UPDATE」；需要同步 input files diff（新增 put、刪除 delete、重新命名視為刪+加）。

## Delete Flow（DB first，best-effort S3 cleanup）

關鍵：**DB 先刪**。反過來（先刪 S3）會產生「DB 有 row 但 read 404」的最糟 failure mode。

```ts
// 在 deleteProblem
await prisma.problem.delete({ where: { id: problemId } });
// Prisma cascade 負責 DB 層級的 TestcaseSet / Testcase / ProblemWorkspaceFile 清理

try {
  await deleteBlobsByPrefix(storage, problemPrefix(problemId));
} catch (err) {
  logger.warn("Orphan S3 blobs after problem delete", { problemId, err });
  // 不 rethrow：DB 已 commit，user-visible state 已正確
}
```

同理，`deleteTestcase` / `deleteWorkspaceFile` 走 per-key `deleteBlob`，best-effort catch + warn log。

**失敗矩陣**：

| 狀況           | DB  | S3  | 結果                               |
| -------------- | --- | --- | ---------------------------------- |
| DB 失敗        | ✗   | —   | 拋錯，零副作用                     |
| DB OK，S3 失敗 | ✓   | ✗   | orphan S3 blob，無人指向，log warn |
| 都 OK          | ✓   | ✓   | 正常                               |

**不建 GC workflow**（YAGNI）。等實際在 S3 console 看到 orphan 累積再決定是否加 weekly Temporal sweep。

## Read Flow

### Worker（judge 流程）

`packages/domain/src/submission/judge-context.ts:95` 目前直接從 DB row 拿 `testcase.inputFiles`。改成：

```ts
const [input, output, fileEntries] = await Promise.all([
  getText(storage, tc.inputKey),
  tc.outputKey ? getText(storage, tc.outputKey) : Promise.resolve(undefined),
  Promise.all(
    Object.entries((tc.inputFileKeys as Record<string, string> | null) ?? {}).map(
      async ([name, key]) => [name, await getText(storage, key)] as const,
    ),
  ),
]);
const inputFiles = Object.fromEntries(fileEntries);
```

回傳形狀（`Record<string, string>`）對 sandbox-runner 零變更 — sandbox-runner 本來就從 k8s-mounted volume 讀 `testcase-N-input.txt`，worker 那端只是把來源從 DB 換成 S3 再寫到同一個 mount。

### Web UI（edit page）

`apps/web/src/routes/(app)/problems/[id]/edit/+page.server.ts`（含 advanced 版本）在 SSR `load()` 平行下載所有 testcase + workspace file 的 S3 內容，傳給前端顯示。SSR 本來就慢，多一次 S3 round-trip 影響可忽略。

## Schema Validation 調整

`packages/core/src/schemas/problem.ts`：

- `problemTestcaseCaseSchema`、`problemJudgeTestcaseSchema` 的 `.max(200_000)` / `.max(1_000_000)` 原本對應 Postgres TEXT 的實務上限，搬到 S3 後可以放寬或完全拿掉（object size limit 由 S3 層統一控制，或交給 `@nojv/storage` 內的 guard）
- 先暫定維持相同上限（保守），若需要放寬再另外開 PR

## Local Dev：用 Garage 換掉 MinIO

**產品選擇**：[Garage](https://garagehq.deuxfleurs.fr/)（Rust，Deuxfleurs 維護，active OSS）。原因：

- 定位明確為「self-hosted S3 替代品」，API 相容度高
- 單 binary、輕量、無商業 pivot 風險
- LocalStack 包山包海，為 S3 單一用途 overkill；SeaweedFS 功能過剩；R2 dev bucket 引入網路依賴

**改動**：

```yaml
# docker-compose.yml
garage:
  image: dxflrs/garage:v1.0.1
  ports:
    - "3900:3900" # S3 API
    - "3903:3903" # admin API (health + management)
  volumes:
    - ./.garage/meta:/var/lib/garage/meta
    - ./.garage/data:/var/lib/garage/data
    - ./infra/docker/garage.toml:/etc/garage.toml
```

新檔案：

- `infra/docker/garage.toml` — Garage 需要 config 檔（MinIO 用純 env var）
- `scripts/bootstrap-garage.sh` — 第一次啟動跑 `garage layout assign` + `garage bucket create nojv` + `garage key new`，輸出 S3 access/secret key 到 stdout

**要清掉**：

- `docker-compose.yml` 的 `minio:` service
- `./Back-End/minio/data` volume（若還在）
- 所有 `MINIO_*` env 引用（`.env.example`、runbook）

**Env var 調整**：`.env.example` 的 `S3_ENDPOINT` 從 `http://localhost:9000` 改 `http://localhost:3900`；`S3_ACCESS_KEY` / `S3_SECRET_KEY` 用 bootstrap 腳本吐出的值。Production 的 GCS/R2 設定不動。

**Getting Started runbook**（`docs/runbooks/getting-started.md`）更新：MinIO setup 步驟全部換成 `scripts/bootstrap-garage.sh`。

## Testing

- **Unit tests**：`@nojv/storage` 在 domain mutation 測試裡 `vi.mock("@nojv/storage")`。測 write order、delete order、S3 fail + DB fail 的 failure mode 分支
- **Integration tests**（`tests/integration/`）：在既有 Docker 相依（Postgres + Redis）旁新增 Garage container。走完整 CRUD，驗證 S3 真的有物件、DB 真的有 key
- **E2E**（Playwright）：用同一個 Garage instance，不開第二份

新增：

- `tests/unit/storage/keys.test.ts` — 純函式驗證 key builder
- `tests/unit/domain/testcase-blob-mutations.test.ts` — 涵蓋 create/update/delete + 失敗分支

## Seed Script

`packages/db/prisma/seed.ts` 目前直接 `prisma.testcase.create({ input: "...", output: "..." })`。改成呼叫同一套 domain mutation（走 S3 first + DB insert），**確保 seed 跟 production 用同一條路徑**，不維護平行實作。

## Rollout（PR 切分）

1. **PR 1**：`@nojv/storage` 加 `keys.ts` + `blobs.ts`，純新 code，零 breaking。含單元測試
2. **PR 2**：Prisma migration（drop 舊四欄、add 新 key 欄位）+ domain mutations 改寫 + judge-context 改寫 + seed 改寫 + 新單元/整合測試。**主 PR**
3. **PR 3**：`docker-compose.yml` 改 Garage + `infra/docker/garage.toml` + `scripts/bootstrap-garage.sh` + `.env.example` + Getting Started runbook。與 PR 2 獨立，先後順序不拘
4. **PR 4（可選，延後）**：weekly GC workflow — 等實際在 S3 console 看到 orphan 累積再做

每個 PR 可獨立 review + rollback。

## Out of Scope（明確不做）

- 大檔案分塊上傳 / 多段上傳（testcase 上限 <1MB，用不到）
- Content-addressed 去重（OJ 幾乎不會跨題重用 testcase）
- 版本歷史 / 撤銷編輯（沒人要求）
- Backfill script（沒有 production user data 要保）
- Weekly GC workflow（YAGNI，等看到 orphan 再做）
- Small-file inline 優化（<4KB 不走 S3，小省 latency 但增加程式碼複雜度，不值得）
- Presigned URL 直接 client 上傳（testcase 檔案小，admin 流程不是性能熱點）
