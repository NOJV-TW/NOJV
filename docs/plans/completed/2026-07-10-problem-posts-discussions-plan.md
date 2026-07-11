# Problem Posts 實作計畫

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 依 [設計文件](./2026-07-10-problem-posts-discussions.md) 把 Editorial 改造成統一的 ProblemPost(解答/討論兩型),加上兩層留言與統一檢舉審核。

**Architecture:** DB 層 rename+改造既有 Editorial 系列表 → repositories → application domain(`post/`)→ SvelteKit API routes → 前端頁面 → admin 後台。全程沿用現有分層與慣例(`apiHandler`/`writeApiHandler`、`requireApiAuth`、ActorContext、soft-delete)。

**Tech Stack:** Prisma 7 + PostgreSQL 18、Zod 4(schemas 在 `@nojv/core`)、SvelteKit + Svelte 5 + Tailwind 4 + Bits UI、Vitest、paraglide i18n。

**Worktree:** `.worktrees/problem-posts-discussions`(branch `feat/problem-posts-discussions`)。

**重要環境注意(來自專案記憶):**

- dev DB 用 `pnpm db:push`,**絕不跑 `prisma migrate dev`**(會提示 reset)。migration SQL 手寫。
- 改 `apps/web/messages/*.json` 後必跑 `pnpm --filter @nojv/web paraglide:compile`。
- 改 schema 後必跑 `pnpm db:generate`。
- 單元測試跑 `pnpm test:unit`;全套驗證 `pnpm ci:verify`。
- 不寫任何程式註解(專案規範)。

---

### Task 1: Prisma schema 改造

**Files:**

- Modify: `packages/db/prisma/schema/submission.prisma`(行 202-258 的 Editorial 三個 model)
- Modify: `packages/db/prisma/schema/auth.prisma`(User 關聯,行 53-54、68-69 附近)
- Modify: `packages/db/prisma/schema/problem.prisma`(Problem 關聯,行 61 附近)
- Modify: `packages/db/prisma/schema/notification.prisma`(NotificationType enum)
- Modify: `packages/db/prisma/schema/ops.prisma`(AdminAuditAction enum,行 61-62 附近)

**Step 1:** 把 submission.prisma 中 `EditorialReportStatus`/`Editorial`/`EditorialVote`/`EditorialReport` 換成:

```prisma
enum ContentReportStatus {
  open
  resolved
  dismissed
}

enum ProblemPostType {
  editorial
  discussion
}

model ProblemPost {
  id        String          @id @default(cuid())
  type      ProblemPostType
  authorId  String
  problemId String
  title     String
  content   String          @db.Text
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  deletedAt DateTime?
  author    User            @relation(fields: [authorId], references: [id], onDelete: Cascade)
  problem   Problem         @relation(fields: [problemId], references: [id], onDelete: Cascade)
  comments  PostComment[]
  reports   ContentReport[]
  votes     PostVote[]

  @@index([problemId, type, createdAt])
}

model PostVote {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  value     Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  post ProblemPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  user User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([postId, userId])
  @@index([postId])
}

model PostComment {
  id        String    @id @default(cuid())
  postId    String
  authorId  String
  parentId  String?
  content   String    @db.Text
  createdAt DateTime  @default(now())
  deletedAt DateTime?

  post    ProblemPost     @relation(fields: [postId], references: [id], onDelete: Cascade)
  author  User            @relation(fields: [authorId], references: [id], onDelete: Cascade)
  parent  PostComment?    @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies PostComment[]   @relation("CommentReplies")
  reports ContentReport[]

  @@index([postId, createdAt])
}

model ContentReport {
  id               String              @id @default(cuid())
  postId           String?
  commentId        String?
  reportedByUserId String
  reason           String              @db.Text
  status           ContentReportStatus @default(open)
  resolvedByUserId String?
  resolvedAt       DateTime?
  createdAt        DateTime            @default(now())

  post       ProblemPost? @relation(fields: [postId], references: [id], onDelete: Cascade)
  comment    PostComment? @relation(fields: [commentId], references: [id], onDelete: Cascade)
  reportedBy User         @relation("ContentReportReporter", fields: [reportedByUserId], references: [id], onDelete: Cascade)
  resolvedBy User?        @relation("ContentReportResolver", fields: [resolvedByUserId], references: [id], onDelete: SetNull)

  @@unique([postId, reportedByUserId])
  @@unique([commentId, reportedByUserId])
  @@index([status, createdAt])
}
```

(「postId/commentId 恰一非空」的 CHECK 約束 Prisma 不會建模,放在 migration SQL 手寫,參考 Participation 的先例。)

**Step 2:** 更新 User 關聯(auth.prisma):`editorials`→`problemPosts ProblemPost[]`、`editorialVotes`→`postVotes PostVote[]`、`editorialReportsFiled`→`contentReportsFiled ContentReport[] @relation("ContentReportReporter")`、`editorialReportsResolved`→`contentReportsResolved ContentReport[] @relation("ContentReportResolver")`,新增 `postComments PostComment[]`。Problem 關聯 `editorials Editorial[]`→`posts ProblemPost[]`。

**Step 3:** notification.prisma 的 `NotificationType` enum:保留 `editorial_removed`(歷史列),新增 `post_removed`、`comment_removed`。ops.prisma 的 `AdminAuditAction`:保留舊值,新增 `content_report_resolve`、`content_report_dismiss`。

**Step 4:** `pnpm db:generate` 確認 schema 有效(此時 typecheck 會壞,正常,後續 task 修)。

**Step 5:** Commit `feat(db): reshape editorial models into problem posts schema`。

---

### Task 2: Migration SQL(資料保留式)

**Files:**

- Create: `packages/db/prisma/migrations/20260712000000_problem_posts/migration.sql`

**Step 1:** 先用 Prisma 產出「乾淨版」SQL 拿到正確的 constraint/index 命名:

```bash
pnpm --filter @nojv/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script --shadow-database-url "$DATABASE_URL_SHADOW_OR_SCRATCH"
```

(若無 shadow URL,可在本機 postgres 開一個 scratch DB 代替。)

**Step 2:** 手改成資料保留版。核心內容(以 Step 1 產出的名稱為準校正):

```sql
CREATE TYPE "ProblemPostType" AS ENUM ('editorial', 'discussion');
ALTER TYPE "EditorialReportStatus" RENAME TO "ContentReportStatus";
ALTER TYPE "NotificationType" ADD VALUE 'post_removed';
ALTER TYPE "NotificationType" ADD VALUE 'comment_removed';
ALTER TYPE "AdminAuditAction" ADD VALUE 'content_report_resolve';
ALTER TYPE "AdminAuditAction" ADD VALUE 'content_report_dismiss';

ALTER TABLE "Editorial" RENAME TO "ProblemPost";
ALTER TABLE "ProblemPost" RENAME COLUMN "userId" TO "authorId";
ALTER TABLE "ProblemPost" ADD COLUMN "type" "ProblemPostType" NOT NULL DEFAULT 'editorial';
ALTER TABLE "ProblemPost" ALTER COLUMN "type" DROP DEFAULT;
UPDATE "ProblemPost" SET "title" = "language"::text WHERE "title" = '';
ALTER TABLE "ProblemPost" DROP COLUMN "language";
ALTER TABLE "ProblemPost" ALTER COLUMN "title" DROP DEFAULT;
-- rename PK/FK/index 至 Prisma 預設名稱(依 Step 1 輸出),例如:
ALTER TABLE "ProblemPost" RENAME CONSTRAINT "Editorial_pkey" TO "ProblemPost_pkey";
DROP INDEX "Editorial_userId_problemId_language_key";
ALTER INDEX "Editorial_problemId_createdAt_idx" RENAME TO ...; -- 或 drop+create 新 index
CREATE INDEX "ProblemPost_problemId_type_createdAt_idx" ON "ProblemPost"("problemId", "type", "createdAt");

ALTER TABLE "EditorialVote" RENAME TO "PostVote";
ALTER TABLE "PostVote" RENAME COLUMN "editorialId" TO "postId";
-- 同樣 rename PK/FK/unique/index

CREATE TABLE "PostComment" ( ... 依 Step 1 輸出 ... );

ALTER TABLE "EditorialReport" RENAME TO "ContentReport";
ALTER TABLE "ContentReport" RENAME COLUMN "editorialId" TO "postId";
ALTER TABLE "ContentReport" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "ContentReport" ADD COLUMN "commentId" TEXT;
-- rename 舊 PK/FK/unique/index、新增 commentId FK 與 unique(依 Step 1 輸出)
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_target_check"
  CHECK (num_nonnulls("postId", "commentId") = 1);
```

**Step 3:** 本機驗證,完全比照 CI 的 drift gate:

```bash
psql -c 'CREATE DATABASE nojv_migrate_check;'  # 以本機 postgres
DATABASE_URL=postgresql://...nojv_migrate_check pnpm --filter @nojv/db exec prisma migrate deploy
DATABASE_URL=postgresql://...nojv_migrate_check pnpm --filter @nojv/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code
```

Expected: exit 0(無 drift)。注意 CHECK 約束若造成 diff 噪音,比照既有 Participation CHECK 的處理方式(查該 migration 怎麼寫、schema 怎麼避開)。

**Step 4:** dev DB 套用:`pnpm db:push`,然後 `pnpm db:seed`(若 seed 有 editorial 資料需同步修,grep `packages/db/prisma/seed` 中的 `editorial`)。

**Step 5:** `pnpm db:docs` 重新產生 `docs/architecture/DATABASE.generated.md`,一併 commit。

**Step 6:** Commit `feat(db): problem posts migration with data-preserving renames`。

---

### Task 3: DB repositories

**Files:**

- Rename+rework: `packages/db/src/repositories/editorial.ts` → `post.ts`(`postRepo`)
- Rename+rework: `packages/db/src/repositories/editorial-vote.ts` → `post-vote.ts`(`postVoteRepo`)
- Rename+rework: `packages/db/src/repositories/editorial-report.ts` → `content-report.ts`(`contentReportRepo`)
- Create: `packages/db/src/repositories/post-comment.ts`(`postCommentRepo`)
- Modify: `packages/db/src/repositories/index.ts`(exports)

**Step 1:** `postRepo` 以現有 editorialRepo 為底改造:

- `listByProblemIdPaged(problemId, type, skip, take)` / `countByProblemId(problemId, type)`:where 加 `type`,include author(`userPublicSelect`)、`votes: { select: { userId, value } }`、`_count: { select: { comments: { where: { deletedAt: null } } } }`。
- `existsForUserProblem(userId, problemId)`:僅查 `type: "editorial"`(供「作者可看解答」判定)。
- `findById(id)`:include author。
- `create({ type, authorId, problemId, title, content })`(取代 upsert)。
- `update(id, { title?, content? })`、`softDelete(id)` 照舊。

**Step 2:** `postVoteRepo`:欄位改名(`editorialId`→`postId`),`setVote`/`aggregate` 邏輯照舊。

**Step 3:** `postCommentRepo`(新):

- `listByPostId(postId)`:全部留言含已刪(tombstone 需要),orderBy createdAt asc,include author。
- `findById(id)`。
- `create({ postId, authorId, parentId, content })`。
- `softDelete(id)`。
- `countActiveByPostId(postId)`。

**Step 4:** `contentReportRepo`:`create({ postId? | commentId?, reportedByUserId, reason })`、`listByStatus(status)`(include post→problem/author、comment→post→problem/author、reportedBy)、`findById`、`updateStatus` 照舊改名。

**Step 5:** `pnpm --filter @nojv/db build`(或 typecheck)確認編譯過。Commit `feat(db): post/comment/report repositories`。

---

### Task 4: core Zod schemas

**Files:**

- Rename+rework: `packages/core/src/schemas/editorial.ts` → `post.ts`
- Modify: `packages/core/src/schemas/index.ts`(或對應 re-export 處,grep `editorialSubmitSchema` 修正)

**Step 1:** 內容(沿用原本的長度界線;拿掉 language;新增 comment):

```ts
export const problemPostTypeSchema = z.enum(["editorial", "discussion"]);
export const postSubmitSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(10).max(50_000),
});
export const postUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().min(10).max(50_000).optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "At least one field (title or content) is required.",
  });
export const postVoteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});
export const contentReportSchema = z.object({ reason: z.string().min(1).max(1000) });
export const postCommentSubmitSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  parentId: z.string().nullish(),
});
```

列表 entry schema(原 `editorialEntrySchema`)同步改:拿掉 `language`,加 `type`、`commentCount`。

**Step 2:** `pnpm --filter @nojv/core build` 過。Commit `feat(core): problem post schemas`。

---

### Task 5: application domain — queries + mutations(TDD)

**Files:**

- Rename dir: `packages/application/src/editorial/` → `post/`(queries.ts、mutations.ts、reports.ts→下一 task、index.ts)
- Modify: `packages/application/src/index.ts`(`editorialDomain`→`postDomain`,grep 全 repo `editorialDomain`)
- Test(rework): `tests/unit/domain/editorial-queries.test.ts` → `post-queries.test.ts`,`editorial-mutations.test.ts` → `post-mutations.test.ts`,`editorial-votes.test.ts` → `post-votes.test.ts`;`editorial-context-gate.test.ts`、`editorial-resolve-context.test.ts` 改名為 `post-*` 並修 import(gate 邏輯不變)

**Step 1(先寫測試):** 依現有測試的 mock 風格(先讀原檔),改寫並新增案例:

- `canViewPosts(userId, problemId, "editorial", context)`:同現有 canViewEditorials(gate 開 + 作者或 AC)。
- `canViewPosts(userId, problemId, "discussion", context)`:gate 開即 true(登入由 API 層保證),**不需 AC**;gate 關(考試/比賽進行中)→ false。
- `createPost`:editorial type 需 canViewPosts 通過;discussion type 登入即可(但 gate 關 → Forbidden)。
- `updatePost`/`softDeletePost`:作者或 admin;其他人 Forbidden;已刪 → NotFound。
- `castPostVote`:自己的帖不能投;editorial 需 AC、discussion 不需;gate 關 → Forbidden。

Run: `pnpm test:unit -- tests/unit/domain/post-` Expected: FAIL(函式不存在)。

**Step 2:** 實作。`queries.ts`:保留 `hasUserAcProblem`、`contextGateOpen`、`resolveActiveContextForUser`(原封不動),`canViewEditorials` 改成:

```ts
export async function canViewPosts(
  userId: string,
  problemId: string,
  type: ProblemPostType,
  context?: EditorialViewContext,
): Promise<boolean> {
  const gateOpen = await contextGateOpen(context ?? { kind: "practice" });
  if (!gateOpen) return false;
  if (type === "discussion") return true;
  const authored = await postRepo.existsForUserProblem(userId, problemId);
  if (authored) return true;
  return hasUserAcProblem(userId, problemId);
}
```

`listPostsPage({ problemId, type, page, pageSize })` 由 listEditorialsPage 改造(items 附 voteScore/viewerVote/commentCount)。`getPostById` 同原邏輯。`mutations.ts`:`createPost`(取代 upsertEditorial,內含 gate 檢查)、`updatePost`、`softDeletePost`、`castPostVote`(依 type 分流 gate)。

**Step 3:** `pnpm test:unit -- tests/unit/domain/post-` Expected: PASS。

**Step 4:** Commit `feat(application): post domain queries and mutations`。

---

### Task 6: application domain — comments + reports(TDD)

**Files:**

- Create: `packages/application/src/post/comments.ts`
- Rework: `packages/application/src/post/reports.ts`
- Modify: `packages/application/src/notification/email.ts`(email specs)
- Test: rework `tests/unit/domain/editorial-reports.test.ts` → `content-reports.test.ts`;Create `tests/unit/domain/post-comments.test.ts`

**Step 1(先寫測試):**

- comments:`addComment` 需能看該帖(依 post.type 走 canViewPosts);reply 的 parentId 必須是同帖頂層留言(parent 有 parentId → ValidationError;parent 不同 post → ValidationError);對已刪帖留言 → NotFound。`softDeleteComment`:作者或 admin;已刪 → NotFound。`listComments`:回傳含已刪留言,已刪者 content 置空、標記 `deleted: true`(tombstone 由前端渲染),作者資訊已刪者不外洩內容。
- reports:`reportContent(actor, { postId | commentId }, reason)`:不能檢舉自己的內容;重複檢舉 → Conflict(P2002);對已刪目標 → NotFound。`resolveContentReport(actor, reportId, "resolve")`:目標是帖 → softDeletePost + `post_removed` 通知作者;目標是留言 → softDeleteComment + `comment_removed` 通知;`"dismiss"` 僅改狀態。非 admin → Forbidden。目標已被先前 report 刪除 → 仍可結案、不重複通知。

Run: `pnpm test:unit -- tests/unit/domain/post-comments tests/unit/domain/content-reports` Expected: FAIL。

**Step 2:** 實作,結構照抄原 reports.ts。通知 email specs:在 `email.ts` 新增 `post_removed`、`comment_removed`,prefKey 沿用 `emailEditorialRemoved`(不加新偏好欄位),文案比照 `editorial_removed` 改為「文章/留言已被移除」;保留 `editorial_removed` spec(歷史通知)。

**Step 3:** `pnpm test:unit -- tests/unit/domain/` Expected: 全 PASS。

**Step 4:** Commit `feat(application): post comments and unified content reports`。

---

### Task 7: API routes

**Files:**

- Rework: `apps/web/src/routes/api/problems/[id]/editorials/+server.ts` → `api/problems/[id]/posts/+server.ts`(GET 列表 `?type=`、POST 發文)
- Rework: `apps/web/src/routes/api/editorials/[id]/` → `api/posts/[id]/`(`+server.ts` GET/PATCH/DELETE、`votes/+server.ts`、`reports/+server.ts`)
- Create: `apps/web/src/routes/api/posts/[id]/comments/+server.ts`(GET/POST)
- Create: `apps/web/src/routes/api/comments/[id]/+server.ts`(DELETE)
- Create: `apps/web/src/routes/api/comments/[id]/reports/+server.ts`(POST)
- Check: `tests/unit/security/exam-confinement-api-allowlist.test.ts`(API 路徑異動後 allowlist 是否要更新;考試 confinement **不得**放行 posts/comments 路徑)

**Step 1:** 每個 handler 的固定骨架(照抄現有 editorials `+server.ts` 慣例):`requireApiAuth` → 解析 params/body(Zod)→ `resolveActiveContextForUser(actor.userId, problemId, new Date())` → `canViewPosts(..., type, context)` 不過就 403 → 呼叫 domain。留言/投票/檢舉 endpoints 由 post/comment 反查 problemId 後跑同一 gate。admin(`actor.platformRole === "admin"`)繞過 view gate(比照現有列表頁行為)。

**Step 2:** 全 repo grep `api/editorials|api/problems/[id]/editorials` 修掉引用(前端 fetch、OpenAPI 文件若有)。`pnpm --filter @nojv/web typecheck`。

**Step 3:** 手動 smoke(dev server + curl 或既有 auth fixture):discussion GET 未 AC 帳號 200、editorial GET 未 AC 帳號 403。

**Step 4:** Commit `feat(web): posts/comments/reports API routes`。

---

### Task 8+9: 前端 — 工作區側欄內完整體驗(LeetCode 模式,無獨立頁面)

**設計變更(2026-07-11 使用者裁決):解答與討論不做獨立頁面,完整活在題目工作區左側面板內**,參考 LeetCode 解答分頁:tab 內列表 → 點開文章(含留言)→ 發文/編輯,全部面板內視圖切換。

**Files:**

- Rework: `apps/web/src/lib/components/features/problem/left-panel/EditorialListPanel.svelte` → 泛用 `PostPanel.svelte`(props 帶 type;內含 list/article/compose 三種視圖狀態)
- Create: 子元件 `apps/web/src/lib/components/features/posts/`:`PostListView.svelte`(列表+排序+發文按鈕+discussion spoiler 提醒)、`PostArticleView.svelte`(返回鍵、Markdown 內容、投票、檢舉、編輯/刪除、`CommentSection`)、`CommentSection.svelte`(兩層留言、回覆/檢舉/刪除、tombstone)、`PostForm.svelte`(標題+內容 textarea,new/edit 共用)、`ReportDialog.svelte`
- Modify: `apps/web/src/lib/components/features/problem/layouts/ProblemLeftPanel.svelte`:tab 增加「討論」;解答 tab 維持 AC gate、討論 tab 登入即顯示;僅練習模式渲染兩個 tab(考試/比賽 workspace 不渲染——確認呼叫端如何區分模式)
- Modify: `ProblemWorkspace.svelte`、`AdvancedModeWorkspace.svelte`、`ProblemSolveView.svelte`(props 傳遞)
- Delete: `apps/web/src/routes/(app)/problems/[problemId]/editorials/`(獨立頁)與 `apps/web/src/routes/(app)/editorials/`(舊 edit 頁)整目錄;FRONTEND.md 路由表同步
- Modify: `apps/web/src/routes/(app)/problems/[problemId]/+page.server.ts`(canViewEditorials → canViewPosts)
- Modify: `apps/web/src/lib/components/features/notification/NotificationItem.svelte`(補 post_removed/comment_removed case)
- Rework: `tests/e2e/editorials.test.ts` 對齊面板內操作

**要點:**

- 面板內所有資料操作走 Task 7 的 posts API(create 回 201);gate 由 API/domain 管,UI 隱藏是第二道。
- 留言 tombstone 用 i18n 訊息(後端已把已刪留言 content 清空);discussion 列表頂部與發文表單各一行 spoiler 提醒小字。
- 設計規範 `docs/architecture/DESIGN.md`;沿用既有 panel/卡片/按鈕樣式;不寫註解、不用 lint suppression。

**Steps:** 實作 → svelte-check + typecheck 過(僅剩 admin/editorial-reports 殘錯屬 Task 11)→ `pnpm test:unit` 綠(route-map gate)→ paraglide 訊息 + compile(Task 10 併入)→ dev server 手動全流程驗證 + 截圖 → Commit。

---

### Task 10: paraglide 訊息

**Files:**

- Modify: `apps/web/messages/zh-tw.json`(或現有語系檔,ls `apps/web/messages/`)與 `en.json`

**Steps:** 收集 Task 8/9/11 全部新 UI 字串(tab 名「討論」、spoiler 提醒、tombstone、檢舉 dialog、admin 佇列欄位等),加進訊息檔 → `pnpm --filter @nojv/web paraglide:compile` → svelte-check 過 → 併入相鄰 task 的 commit 或單獨 commit `feat(web): post/discussion i18n messages`。

---

### Task 11: Admin 審核後台

**Files:**

- Rework: `apps/web/src/routes/(app)/admin/editorial-reports/` → `admin/reports/`(`+page.server.ts` + `+page.svelte`)
- Modify: `apps/web/src/routes/(app)/admin/+layout.svelte`(行 8-15 tabs、行 17-26 tabLabel)

**要點:**

- load:`listContentReports(actor, "open")`;每列顯示目標類型(解答帖/討論帖/留言)、內容預覽(留言含所屬帖標題)、所屬題目連結、檢舉理由、檢舉人。
- actions:`resolve`/`dismiss` 呼叫 `resolveContentReport`,audit action 用新 enum `content_report_resolve`/`content_report_dismiss`(寫法照抄原 editorial-reports 行 37-70)。
- Resolve 按鈕 destructive + confirm(照原樣)。

**Steps:** 實作 → svelte-check → dev server:檢舉一帖一留言 → admin 佇列出現 → resolve 後留言 tombstone、帖子 404、作者收到通知 → Commit `feat(web): unified content reports admin queue`。

---

### Task 12: 全面收尾驗證

**Step 1:** 全 repo grep 殘留:`grep -rn "editorial" --include="*.ts" --include="*.svelte" apps packages tests | grep -iv "content_report\|post_removed"` — 逐一確認殘留者是刻意保留(`editorial_removed` 歷史通知、migration SQL、`docs/`)。

**Step 2:** 文件同步(lint:doc-drift gate 會抓斷連結):

- `docs/architecture/FRONTEND.md`:routes 異動。
- `docs/architecture/DATABASE.md`:若有手寫 Editorial 段落 → 改 ProblemPost。
- `docs/specs/`:grep editorial,若有 spec 檔,更新 Given/When/Then(加討論區與檢舉)。
- `docs/product/PRODUCT_SENSE.md`:若列了 editorial 功能,補討論區一行。

**Step 3:** `pnpm ci:verify` 全綠;另跑 `pnpm test:integration`(schema 大改,unit 不夠——專案記憶的教訓)。

**Step 4:** 手動完整走一遍驗收(對照設計文件的四個目標),特別驗:

- 未 AC 帳號:討論區可看可發,解答區 403(UI 與直接 curl API 各驗一次)。
- 考試進行中的參加者:直接 curl `api/problems/[examProblemId]/posts?type=discussion` → 403。

**Step 5:** 把設計文件與本計畫移到 `docs/plans/completed/`,commit,開 PR(`gh pr create`),CI 綠依專案慣例直接 `gh pr merge --squash --admin --delete-branch`,merge 後盯 main CI + deploy。
