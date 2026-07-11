# Problem Posts:解答改版 + 討論區 + 留言 + 檢舉審核

## 背景與目標

現有 Editorial 是「每人每題每語言限一篇、發佈即公開、事後檢舉」的模型,無留言、無討論區。
本案把解答與新的討論區收斂成同一種「文章(post)」結構:

1. 解答改成文章頁(標題+內容,一人可發多篇),維持「AC 才能看/發」。
2. 新增討論區:同文章結構,登入即可看/發/留言。
3. 兩區帖子下方都有兩層留言(留言+回覆)。
4. 帖子與留言皆可檢舉,進 admin 統一審核佇列;resolve 刪除目標——留言顯示 tombstone「此則留言已被刪除」,帖子直接消失。

## 資料模型(packages/db)

- **`ProblemPost`**(由 `Editorial` 改造):
  - `id`、`type`(enum `ProblemPostType`: `editorial` | `discussion`)、`problemId`、`authorId`、`title`、`content @db.Text`、`createdAt`、`updatedAt`、`deletedAt`(soft-delete)。
  - 移除 `language` 欄位與 `@@unique([userId, problemId, language])`;index:`@@index([problemId, type, createdAt])`。
  - Migration:既有 Editorial 列 → `type = editorial`;`title` 為空字串者以原 `language` 名補標題。
- **`PostVote`**(由 `EditorialVote` 改造):`postId`、`userId`、`value Int`(+1/-1)、`@@unique([postId, userId])`。兩種 type 皆可投。
- **`PostComment`**(新):`id`、`postId`、`authorId`、`parentId`(nullable self-relation,僅允許一層——reply 的 `parentId` 必須指向頂層留言)、`content @db.Text`、`createdAt`、`deletedAt`。
  - 刪除 = soft-delete,前端渲染 tombstone,回覆串保留。
- **`ContentReport`**(由 `EditorialReport` 改造):`postId?`、`commentId?`(DB CHECK:恰一非空)、`reportedByUserId`、`reason`、`status`(`open`/`resolved`/`dismissed`)、`resolvedByUserId?`、`resolvedAt?`。
  - `@@unique([postId, reportedByUserId])` 與 `@@unique([commentId, reportedByUserId])`(每人每目標一次)。
  - Migration:既有 EditorialReport 列轉入(`postId` = 原 editorialId)。

## 權限與情境 gate(packages/application)

兩種 type 共用同一套 domain/API,差別只在 view gate:

| 動作              | editorial                    | discussion |
| ----------------- | ---------------------------- | ---------- |
| 看列表/單篇       | 已 AC 該題(作者、admin 例外) | 登入       |
| 發文/編輯自己的帖 | 已 AC 該題                   | 登入       |
| 留言/投票/檢舉    | 已 AC 該題                   | 登入       |

- **情境 gate 共用且置前**:所有 post/comment/vote/report endpoint 進入時先跑 server 端 `resolveActiveContextForUser(userId, problemId, now)`(現有邏輯,查使用者當下參加中且包含該題的比賽/作業/考試,取最嚴格 deadline)——gate 未開一律 403。不信任前端 context、不看入口 URL,考試中無法經由 practice 路徑繞過。活動結束後自動開放。
- 不能檢舉自己的內容;reason 1–1000 字。
- 刪帖:作者本人或 admin;刪留言:作者本人或 admin。

## 前端(apps/web)

- `/problems/[id]/editorials`、`/problems/[id]/discussions`:共用列表元件(標題、作者、票數、留言數、時間;票數/時間排序)。討論區列表頁頂部與發文表單各有一行小字:「請勿在討論中洩漏答案或貼出完整解法」。
- 文章頁 `/problems/[id]/{editorials|discussions}/[postId]`:Markdown 內容、投票、檢舉、兩層留言區;留言可回覆/檢舉/刪除。被刪留言顯示「此則留言已被刪除」;被刪帖子列表消失、直達 URL 404。
- 發文/編輯共用表單頁(標題 + Markdown)。
- 題目 workspace 只在練習模式渲染「解答」「討論」tab;考試/比賽 workspace 不渲染(API 已在 server 層擋,UI 隱藏是第二道)。
- API routes 由現有 `api/problems/[id]/editorials`、`api/editorials/[id]/*` 改造為 posts/comments/votes/reports 系列,沿用 `apiHandler`/`writeApiHandler` + `requireApiAuth` 慣例。

## Admin 審核後台

- `/admin/editorial-reports` → `/admin/reports`:統一佇列列出 open 檢舉,顯示目標類型(解答帖/討論帖/留言)、內容預覽、檢舉理由。
- Resolve = soft-delete 目標 + 通知作者(沿用 `editorial_removed` 通知改為泛用 content_removed);Dismiss = 僅結案。兩動作皆寫 admin audit。
- admin nav tabs 更新。

## 明確不做

- 巢狀多層留言(僅兩層)。
- 留言編輯(僅發表與刪除)。
- 檢舉分類/檢舉留言通知檢舉人。
- 未登入訪客瀏覽討論區。
