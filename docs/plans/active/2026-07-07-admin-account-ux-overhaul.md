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
- [ ] 項 2 — 帳號頁「變更密碼」對所有人顯示(缺 hasPassword gate)。`account/+page.svelte:300` 連結無條件;`change-password/+page.server.ts` load 已算 `fnHasPassword` 但未 gate。修:主頁連結加 gate + change-password load 無密碼 redirect。只有 super admin 有密碼。
- [ ] 項 3 — passkey 從「登入方式」(connections)移到「兩階段驗證」(two-factor)。passkey 與 TOTP 都是 step-up 因子(`step-up.ts:60` `hasStepUpFactor = twoFactorEnabled || passkeys.length>0`)。passkey UI 在 `connections/+page.svelte:90-136`,搬到 two-factor;server load `listPasskeys` 一起搬。
- [ ] 項 4 — OAuth(Google/GitHub)上移帳號主頁直接顯示。目前藏在 `connections/+page.svelte:52-88`(`listLinkedProviderIds`)。搬到 `account/+page.svelte` 主頁 + `account/+page.server.ts` load。passkey+oauth 都搬走後 **刪掉 connections 路由**。
- [ ] 項 6c — timeout 走 .env:`packages/application/src/submission/sweep.ts` `getSubmissionPendingTimeoutMinutes` 改讀 `process.env`(預設 10);移除 `setSubmissionPendingTimeoutMinutes` + platform_setting 讀寫;`packages/core/.../platform-settings.ts` 的 KEY/DEFAULT 清掉;worker+web env manifest 要加(注意 env-manifest-parity 測試 + `.default()`);`.env.example`/DEPLOYMENT.md 加 `SUBMISSION_PENDING_TIMEOUT_MINUTES`。**worker 也讀 timeout,兩邊 env 都要。**
- [ ] 項 6d — 新增 admin 全站提交視圖(目前不存在,只有 rejudge log)。需 `packages/application/src/submission/queries.ts` 加 `listAllSubmissionsPaged`(參考 `listRejudgeLogsPaged`);新 route `admin/submissions`。
- [ ] 項 5 + 7 — admin 身分組 UI 重造 + tab 重造。**待設計對齊(見下),先不動手。**

## 待使用者拍板的設計問題(admin 身分組區塊,項 5/7)

使用者對這塊有很多想法,做之前要敲定:

1. **super admin 怎麼顯示?** 單獨顯示「super admin」/ 就顯示「admin」/ 完全不顯示 super 身份?
   - 我的建議:super admin 是內部權限層(能發收 admin、登入強制 2FA),對一般人不暴露「super admin」字樣;admin 管理清單裡用小標記讓其他 admin 認得,公開場合顯示「管理員」。
2. **身分組編輯方式**(使用者說「很怪」):目前是點「角色」欄的 badge 進 inline `<select>` 編輯(`UsersTable.svelte:104-205`),入口隱形。要改成什麼?(明確按鈕 / 下拉選單 / dialog?)
3. **admin 對使用者的操作有哪些?** 目前只有 2 個(改角色、停用/啟用),且分散兩欄。使用者覺得「應該有更多操作」。要加什麼?(重設密碼?查看詳情?刪除?)
4. **admin tab 結構**(項 7):目前 URL 分組不一致(`/system/users`、`/content/announcements`、`/content/editorial-reports`、`/rejudges`)。要怎麼統一 + 加入新的「提交」tab?
5. **rejudge log** 要獨立 tab 還是併進新的「提交」視圖?

## 調查發現的其他 bug(項 5 已知,重造時一併修)

- 角色 diff/confirm/toast 直接印英文 slug(`student`/`admin`)沒套 `roleLabel()`(`UsersTable.svelte:121-140,166-173`;`zh-TW.json:363/364` 甚至寫死 "admin")。
- 狀態 badge(啟用中/停用)vs 動作按鈕(啟用/停用)撞字,語意混淆(`zh-TW.json:343/346/351/355`)。
- filter 用整頁 `goto()` 重查 → 全表 render + header 數字變動 + flex-wrap 重排 → 畫面跳動(`+page.svelte:19-24`,`FilterBar.svelte:43`)。search 需 Enter、role 即時觸發,行為不一致。
- 停用有 `confirm`、啟用/改角色升級無 confirm,危險操作把關不一致。

## 已確認「不是 bug」(回答使用者質疑)

- **項 6a 解題檢舉**:完整運作(前端→API→domain→DB→admin resolve/dismiss 閉環都在),非死碼。
- **項 6b rejudge 放 admin**:全站判題稽核紀錄,放 admin 合理(可考慮併進提交視圖)。
- **項 8 IP gate**:正常運作。
