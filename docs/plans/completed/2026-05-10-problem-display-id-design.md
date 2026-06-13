# Problem `displayId` — 設計文件

- 日期：2026-05-10
- 範圍：題目模型新增人類可讀序號，僅作前端顯示用途
- 狀態：設計已對齊，待建立 implementation plan

## 1. 背景與目標

`Problem.id` 目前是 cuid，這串隨機字 防遍歷上很好但對使用者完全無法辨識。題目列表、編輯器、Assignment / Exam 選題器等多處只能截斷顯示前 14 碼，意義不大。

目標：給每題一個對人類友善的整數序號 `displayId`（1, 2, 3...），純粹給前端顯示用。底層 API、route param、外鍵關聯仍以 cuid 為主鍵，安全與防遍歷不變。

## 2. 不做哪些事

- **不**改 URL：`/problems/<cuid>` 維持現狀；不接受 `/problems/42` 形式。
- **不**做 displayId → cuid 反查 API：避免新增攻擊面。
- **不**重用刪除過的號碼：`#5` 被刪後不會再出現；下一題拿 sequence 的下一格。
- **不**做每作者 / 每課程獨立編號：全域單一 sequence。

## 3. 資料模型

```prisma
model Problem {
  id        String  @id @default(cuid())
  displayId Int     @unique @default(autoincrement())
  // 其餘欄位不變
}
```

- 全域唯一、由 Postgres sequence 自動配發。
- `Int`（32-bit）上限 ≈ 21 億，足夠長期使用。
- `@unique` 已隱含建索引；不另加 `@@index`。
- Prisma 會把 `@default(autoincrement())` 對應到 sequence `Problem_displayId_seq`，下方 migration 用同名 sequence 對齊。

## 4. Migration 與既有資料回填

新增 migration：`packages/db/prisma/migrations/<timestamp>_add_problem_display_id/migration.sql`

```sql
-- 1. 先 nullable 加欄位，避免衝擊既有寫入
ALTER TABLE "Problem" ADD COLUMN "displayId" INTEGER;

-- 2. 依 createdAt ASC 回填；同秒以 id 字典序為 tie-breaker
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Problem"
)
UPDATE "Problem" p
SET "displayId" = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

-- 3. 建 sequence、銜接到欄位 (空表時 MAX 為 NULL，COALESCE 0 從 #1 起)
CREATE SEQUENCE "Problem_displayId_seq" AS INTEGER OWNED BY "Problem"."displayId";
SELECT setval(
  '"Problem_displayId_seq"',
  COALESCE((SELECT MAX("displayId") FROM "Problem"), 0) + 1,
  false
);

-- 4. 鎖 NOT NULL + 預設值 + UNIQUE
ALTER TABLE "Problem"
  ALTER COLUMN "displayId" SET NOT NULL,
  ALTER COLUMN "displayId" SET DEFAULT nextval('"Problem_displayId_seq"');
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_displayId_key" UNIQUE ("displayId");
```

要點：

- 整支 migration 在單一 transaction（Prisma migrate 預設行為）；中途任一步失敗 rollback，不會留半成品。
- Sequence 名稱 `Problem_displayId_seq` 對齊 Prisma `@default(autoincrement())` 預期，後續 `prisma migrate dev` 不會再生重複 sequence。
- 空題目資料庫由 `COALESCE` 處理；新建第一題會拿到 #1。

## 5. 後端 / Domain 層

**讀取面**

- `packages/application/` 內把 Problem 投影給前端的查詢（`getProblemPageData`、`getProblemRowById`、`listProblems` 等）的 select 欄位加上 `displayId`。
- `packages/core/` 內 Problem 相關 Zod 輸出 schema（`ProblemSummary`、`ProblemDetail` 等）加 `displayId: z.number().int().positive()`。
- 不新增「以 displayId 反查」的查詢函式 — URL 路由仍走 cuid，沒這需求。

**寫入面**

- 新增題目時不傳 `displayId`，由 sequence 自動配發。
- `ProblemCreate` / `ProblemUpdate` schema 不收 `displayId`，client 不能指定。

**API 邊界**

- 既有 loader / REST 回傳的 problem 物件多一個 `displayId` 欄位，純加法。
- URL、route param、relation FK、submission / exam / contest 連結通通仍以 cuid 為主鍵。

## 6. 前端顯示

**集中工具**

- 加 i18n 鍵 `common_problemDisplayId`，帶參數 `{id}`，預留多語彈性。中文與英文目前都是 `#{id}`（含 `#` 字元）。
- 在 `apps/web/src/lib/utils/` 新增 `formatProblemDisplayName({ displayId, title })`，內部以 `m.common_problemDisplayId({ id: displayId })` 取得序號字串，再以 `${序號} ${title}` 拼接後回傳。
- 未來若某語系希望用「第 42 題」之類格式，只改 message，不動函式與呼叫端。

**替換現存截斷 cuid 的位置**（4 處）

- `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte:209` — `{problem.id.slice(0, 14)}` → `#{problem.displayId}`
- `apps/web/src/routes/(app)/courses/[courseId]/exams/new/+page.svelte:258` — `{problem.id}` → `#{problem.displayId}`
- `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte:229` — `{problem.id}` → `#{problem.displayId}`
- `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte:281` — `{problem.id}` → `#{problem.displayId}`

**標題前綴 `#N` 套用點**

- 題目列表卡片：`apps/web/src/lib/components/problem/Tabs.svelte`（public 與 mine 兩段 `{problem.title}`）
- 題目詳情頁：`apps/web/src/lib/components/problem/ProblemLeftPanel.svelte`
- 題目編輯頁 header：`apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte`
- Editorials：`apps/web/src/routes/(app)/problems/[problemId]/editorials/+page.svelte`
- Editorials Edit 返回連結：`apps/web/src/routes/(app)/editorials/[id]/edit/+page.svelte`
- 提交詳情頁：`apps/web/src/routes/(app)/submissions/[submissionId]/+page.svelte`
- Dashboard 提交記錄：`apps/web/src/routes/(app)/dashboard/+page.svelte`
- Admin 列表：`apps/web/src/routes/(app)/admin/+page.svelte`
- Assignment / Exam 內顯示題目處：`apps/web/src/routes/(app)/assignments/[assessmentId]/+page.svelte` 等

**不動的地方**

- URL、`href`、route param 維持 cuid。
- `{#each ... (problem.id)}` keyed list 仍用 cuid（更穩定，刪題目時不會洗整段）。

## 7. 測試計畫

**Unit (vitest)**

- `tests/unit/web/format-problem-display-name.test.ts`：`formatProblemDisplayName({ displayId: 42, title: "二分搜尋" })` → `"#42 二分搜尋"`；空字串、特殊字元邊界。
- 既有 `tests/unit/domain/problem-mutations.test.ts` 加：以 `createProblem` 連續建 3 題，`displayId` 為 `n, n+1, n+2`（不硬編 1/2/3，從當前 sequence 起算）。

**Integration (vitest, 真 Postgres)**

- 新增 `tests/integration/db/problem-display-id-backfill.test.ts`：
  1. 套用「上一支 migration」（還沒 `displayId` 的狀態），插 5 筆 Problem，`createdAt` 故意打亂。
  2. 套用 `add_problem_display_id` migration。
  3. 斷言所有列 `displayId IS NOT NULL`、UNIQUE、按 `createdAt ASC` 為 1..5。
  4. 接著新建一題，斷言 `displayId === 6`（接續 sequence）。
- 既有讀取面 integration test 抽樣加：`getProblemPageData` 回傳含 `displayId`。

**E2E (playwright, 本機)**

- 既有 `tests/e2e/problem-lifecycle.test.ts` 加：標題渲染含 `#<digits>` 前綴。

**不做的測試（YAGNI）**

- 不壓測 sequence 競爭（Postgres sequence 自身保證）。
- 不測 displayId → cuid 反查（不存在此路徑）。

## 8. 影響面總結

| 區塊                   | 變更                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Prisma schema          | `Problem` 新增 `displayId Int @unique @default(autoincrement())`                                                  |
| Migration              | 新增一支 SQL migration，回填既有資料                                                                              |
| `packages/core`        | Zod 輸出 schema 加 `displayId`                                                                                    |
| `packages/application` | 各 Problem 投影查詢 select 加 `displayId`                                                                         |
| `apps/web` 前端        | 新增 `formatProblemDisplayName` 工具、`common_problemDisplayId` i18n 鍵；多處 Problem 顯示點改走此工具（詳見 §6） |
| Tests                  | 新增 unit / integration / E2E 各一條                                                                              |

預期不破壞：URL、API 路徑、外鍵、舊 cuid 連結、既有 client。
