# Admin + Account UX Overhaul Plan

使用者回報 8 項 bug/改進,一次大 PR。分支 `feat/admin-account-ux-overhaul`。
以下是 4 個調查 agent 的診斷 + 已定決策 + **待使用者拍板的設計問題**(使用者出門思考中)。

## 決策(已定)

- **一次大 PR**(不分批)。
- **判題 timeout 改走 .env**(預設 10 分),移除 admin UI 設定(目前走 DB platform_setting + admin UI,預設 30 分)。
- passkey 移到「兩階段驗證」、OAuth 上移帳號主頁、新增 admin 全站提交視圖。
- IP gate 已確認正常(項 8),只需清本地 stale build(已清)。

## 進度

- [x] 項 8 — 清本地 stale build artifacts(`.svelte-kit`/`build`);IP gate source 正常、61 測試綠、cf-connecting-ip 正確,prod 走 GHCR clean build 不受影響。
- [x] 項 1 — admin 切換鈕過期:`(app)/+layout.server.ts` 加 `void event.url.pathname` 讓 layout load 每次導覽重評估 `canActAsAdmin`/`actingAsAdmin`。根因是 layout server load 被快取、client 導覽不重跑,`canActAsAdmin`(=`platformRole==="admin"`,stored role 非 effective)停在過期值;新增 passkey 的 `invalidateAll()` 只是巧合刷新。
- [ ] 項 2 — 帳號頁「變更密碼」對所有人顯示(缺 hasPassword gate)。⚠️ **之前做過且 typecheck 綠,但被並行 reset 丟失,要重做**:`account/+page.server.ts` load 加 `hasPassword: await userHasCredentialPassword(locals.user.id)`(import 自 `$lib/server/step-up`);`account/+page.svelte` 的變更密碼連結包 `{#if data.hasPassword}`;`change-password/+page.server.ts` load 無密碼時 `redirect(303,"/account")`。只有 super admin 有密碼。
- [x] 項 3 — **DONE(commit `91a113b7`)**:passkey 從 connections 移到 two-factor(load `listPasskeys` + `deletePasskey` action + `addPasskey` UI,獨立 Card 放在 TOTP 卡片下方)。
- [x] 項 4 — **DONE(commit `91a113b7`)**:OAuth 上移 account 主頁(load `providers` + `link`/`unlink` action + OAuth Card 放在安全性卡片下方);**`account/connections/` 資料夾已刪除**。
- [ ] 項 6c — timeout 走 .env:`packages/application/src/submission/sweep.ts` `getSubmissionPendingTimeoutMinutes` 改讀 `process.env`(預設 10);移除 `setSubmissionPendingTimeoutMinutes` + platform_setting 讀寫;`packages/core/.../platform-settings.ts` 的 KEY/DEFAULT 清掉;worker+web env manifest 要加(注意 env-manifest-parity 測試 + `.default()`);`.env.example`/DEPLOYMENT.md 加 `SUBMISSION_PENDING_TIMEOUT_MINUTES`。**worker 也讀 timeout,兩邊 env 都要。**
- [ ] 項 6d — 新增 admin 全站提交視圖(目前不存在,只有 rejudge log)。需 `packages/application/src/submission/queries.ts` 加 `listAllSubmissionsPaged`(參考 `listRejudgeLogsPaged`);新 route `admin/submissions`。
- [ ] 項 5 + 7 — admin 身分組 UI 重造 + tab 重造。**待設計對齊(見下),先不動手。**

## admin 身分組/tab 設計(已定案 2026-07-07,待實作)

1. **super admin 不顯示** — 角色欄一律顯示 admin/teacher/student 的本地化,不露「super admin」字樣。
2. **權限規則**:一般 admin **不能**停用/封禁/刪除/改動其他 admin(platformRole===admin)帳號,**只有 super admin 可**;一般 admin 只管 teacher/student。**server action 要 enforce,不只前端隱藏。**
3. **編輯用下拉選單(dropdown menu)**,**不要用 badge 當按鈕(醜)**。每列一個下拉,操作集中:變更角色(選 student/teacher/admin)、停用/啟用、刪除帳號。
4. **新增「刪除帳號」操作**;詳情頁不做(沒明確內容)。domain `deleteUser`(判斷 hard/soft + cascade)+ 記 audit。
5. **URL 統一平級**:`/admin`、`/admin/users`、`/admin/submissions`、`/admin/announcements`、`/admin/editorial-reports`、`/admin/audit`。搬移現有 route 資料夾(users 從 `/system/`、announcements+editorial-reports 從 `/content/` 拉到平級)+ 更新 `admin/+layout.svelte` tab 清單/label/active 判斷。
6. **移除 rejudge 獨立 tab**(log 資料保留,不獨立 tab)。**新增稽核 audit 頁 `/admin/audit`**:記錄 admin 重要操作。
   - 新 Prisma model `AdminAuditLog`:id、actorId、actorName(snapshot)、action(如 `user.role_change`/`user.disable`/`user.enable`/`user.delete`/`editorial_report.resolve`/`editorial_report.dismiss`/`announcement.create`/`announcement.delete`)、targetType?、targetId?、summary、createdAt。產 migration。
   - `packages/application` 加 audit repo + `recordAdminAudit` + `listAdminAuditPaged`。
   - 記錄點:admin 改角色/停用/啟用/刪除、editorial-reports resolve/dismiss、announcements create/delete。
   - `/admin/audit` 頁分頁列出(時間/操作者/動作/對象/摘要)。
7. **項 5 順帶修的 bug**:role diff/confirm/toast 套 `roleLabel()`(別印英文 slug,修 `zh-TW.json:363/364`);狀態(使用中/已停用)vs 動作(停用帳號/啟用帳號)文案分清;filter `goto` 帶 `{keepFocus:true,noScroll:true}` 不跳動、search 與 role 行為一致;危險操作一致 confirm。
8. **項 6d**:新增 `/admin/submissions` 全站提交(目前不存在)。`packages/application/.../submission/queries.ts` 加 `listAllSubmissionsPaged`(參考 `listRejudgeLogsPaged`)。
9. **項 6c**(未做):timeout 走 .env(預設 10 分)。做法(以下是試做過的正確方向):
   - `packages/application/src/submission/sweep.ts` 的 `getSubmissionPendingTimeoutMinutes` 改讀 `process.env.SUBMISSION_PENDING_TIMEOUT_MINUTES`(用 `submissionPendingTimeoutMinutesSchema` 驗證、fallback `DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES`),改成**同步**函式(呼叫處 `sweepStaleSubmissions` 內移掉 `await`);移除 `setSubmissionPendingTimeoutMinutes` 函式 + `platformSettingRepo` / `SUBMISSION_PENDING_TIMEOUT_SETTING_KEY` / `ValidationError` 這幾個 import。
   - `packages/core/src/schemas/platform-settings.ts`:`DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES` 改 **10**;`SUBMISSION_PENDING_TIMEOUT_SETTING_KEY` 等 rejudges UI 移除後一起清掉(否則 orphan);`submissionPendingTimeoutMinutesSchema` 保留(sweep 仍用它驗證)。
   - **⚠️ timeout 一定要上 Helm(使用者特別提醒):`infra/charts/nojv/templates/worker.deployment.yaml` 加 `SUBMISSION_PENDING_TIMEOUT_MINUTES` env(worker 跑 sweep,值從 chart values 注入),`infra/charts/nojv/values.yaml` + `values-single-machine.yaml` 加預設。** web tier 不跑 sweep、不需要。
   - `.env.example` + `docs/operations/DEPLOYMENT.md` 補 `SUBMISSION_PENDING_TIMEOUT_MINUTES` 說明。
   - env-manifest-parity:sweep 直接讀 `process.env`(不經 web/worker env schema),所以不用動 env schema;若之後要納入 schema,記得 `.default()` 否則被當 required → crashloop。
   - **admin/rejudges 頁的 timeout 設定 UI + `updatePendingTimeout` action + `setSubmissionPendingTimeoutMinutes` 呼叫要移除**(併在 admin 批,因為 rejudge tab 本來就要移除)。
10. **全程不寫註解。** i18n 改 `messages/*.json` 後必 `pnpm --filter @nojv/web paraglide:compile`。

## ⏸ 帳號頁批(項 2/3/4)暫停 — 待與使用者討論

使用者要再討論帳號頁呈現,**先不動**。已定方向(供參考,未實作):
- 項 2:`account/+page.svelte:300` 變更密碼連結 + `change-password` load 加 `hasPassword` gate(`userHasCredentialPassword`);只有 super admin 有密碼。
- 項 3:passkey 從 `connections/+page.svelte:90-136` 搬到 `two-factor`(跟 TOTP 同頁,都是 step-up)。
- 項 4:OAuth(`connections` 的 providers link/unlink,用 `getAuth().api`,含 email 通知 + `wouldOrphanAccount` 檢查)上移 `account` 主頁;passkey+oauth 都搬走後刪 `connections` 路由。
- 注意:`connections/+page.svelte` 目前是**硬編中文**(非 paraglide),搬移時決定要不要轉 `m.`。

## 調查發現的其他 bug(項 5 已知,重造時一併修)

- 角色 diff/confirm/toast 直接印英文 slug(`student`/`admin`)沒套 `roleLabel()`(`UsersTable.svelte:121-140,166-173`;`zh-TW.json:363/364` 甚至寫死 "admin")。
- 狀態 badge(啟用中/停用)vs 動作按鈕(啟用/停用)撞字,語意混淆(`zh-TW.json:343/346/351/355`)。
- filter 用整頁 `goto()` 重查 → 全表 render + header 數字變動 + flex-wrap 重排 → 畫面跳動(`+page.svelte:19-24`,`FilterBar.svelte:43`)。search 需 Enter、role 即時觸發,行為不一致。
- 停用有 `confirm`、啟用/改角色升級無 confirm,危險操作把關不一致。

## 已確認「不是 bug」(回答使用者質疑)

- **項 6a 解題檢舉**:完整運作(前端→API→domain→DB→admin resolve/dismiss 閉環都在),非死碼。
- **項 6b rejudge 放 admin**:全站判題稽核紀錄,放 admin 合理(可考慮併進提交視圖)。
- **項 8 IP gate**:正常運作。
