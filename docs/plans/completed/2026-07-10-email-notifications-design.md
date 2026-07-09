# Email 通知功能設計

日期:2026-07-10
狀態:設計已確認,待實作

## 目標

幫既有站內通知系統加上 email 管道 + 使用者偏好設定。同一事件雙管道:站內通知照舊全發,email 受使用者偏好開關控制(全部預設開啟)。

## 通知種類

| 事件         | 站內 type                                    | 觸發                      | email 開關 | 提前天數   |
| ------------ | -------------------------------------------- | ------------------------- | ---------- | ---------- |
| 作業開始     | `assignment_started`(新增)                   | opensAt(已過則發布時立即) | ✓          | —          |
| 作業即將截止 | `assignment_due_soon`                        | closesAt − N 天           | ✓          | 1–7,預設 3 |
| 考試即將開始 | `exam_starting_soon`                         | startsAt − N 天           | ✓          | 1–7,預設 1 |
| 比賽即將開始 | `contest_starting_soon`                      | startsAt − N 天           | ✓          | 1–7,預設 1 |
| 系統公告     | `announcement_published`(courseId null)      | 發布時                    | ✓          | —          |
| 課程公告     | `announcement_published`(courseId 非 null)   | 發布時                    | ✓          | —          |
| 被加入課程   | `course_enrolled`                            | enroll mutation           | ✓          | —          |
| 角色變更     | `role_changed`                               | role mutation             | ✓          | —          |
| 題解審核結果 | `editorial_reviewed`(新增,站內+email 一起補) | 審核 mutation             | ✓          | —          |

明確不做:作業到期(截止當下)通知、提問被回覆 email。

## 資料模型

新表 `NotificationPreference`,one row per user,lazy create(無 row = 全預設):

- `userId String @id` + relation
- 每種通知一個 `email*` Boolean `@default(true)`(見上表)
- `assignmentDueSoonLeadDays Int @default(3)`、`examStartingLeadDays Int @default(1)`、`contestStartingLeadDays Int @default(1)`

用明確欄位而非 JSON:fanout 需要「這批 user 裡 effective leadDays == N」的反向查詢。leadDays Zod 限 1–7。

leadDays 同時決定站內通知與 email 的時間點(統一時間);Boolean 開關只控制 email。

## 排程與 fanout

**即時事件**(公告、加入課程、角色變更、題解審核):在既有 `createNotificationBatch` 呼叫點順帶寄 email。

**排程事件**改 checkpoint 制(取代固定 24h):

- workflow 在 `目標時間 − N 天`(N = 7…1)醒來,只排「未來且不早於 opensAt/發布時間」的 checkpoint。
- 每個 checkpoint 查當下偏好,對 effective leadDays == N 的對象建站內通知 + 寄 email。偏好改了不用重排 workflow。
- `closesAt − N天 < opensAt` 的 checkpoint 不存在 → 作業長度不足 N 天自然不提醒(有開始通知即可)。
- 發布時已過期的 due-soon checkpoint 一律跳過,不立即補發(避免與開始通知連發)。
- 作業開始通知併入同一條 assignment workflow:sleep 到 opensAt(已過則立即)再進 checkpoint 迴圈。
- `TERMINATE_EXISTING` 重派與 lifecycle reconciler 機制照舊。

**去重**:email 跟著站內通知 dedupeKey 的建立結果走 —— dedupe 擋掉的不寄信。

## Email 寄送

- mailer 從 `apps/web/src/lib/server/mailer/` 抽成 `packages/mailer`(`@nojv/mailer`),web 既有信件改 import,worker 也裝上。
- transport 改吃通用 SMTP env(host/port/user/pass),現階段填 Gmail;之後換 SES 只改 env。
  - 已知天花板:Gmail 約 500 封/天。超過時換 SES($0.10/千封,驗 nojv.tw 域名),程式碼不動。
- worker env manifest 新增 SMTP 變數,**必須 `.default("")`**(env-manifest-parity 教訓);未設定時 no-op + warning。
- 信件沿用 `renderEmail` 雙語模板,action 按鈕連到對應頁面;信尾加「管理通知偏好」連結指向 `/account`。
- best-effort:先建站內通知,只對本次新建成功的人逐封寄;單封失敗 log 不拋錯、不重寄。

## 設定 UI

- `/account` 新增「Email 通知」列,沿用 security link-card 樣式,點擊開 Dialog(參考 `CourseAnnouncementDialog` 模式)。
- Modal 分組:作業(開始、即將截止+天數)/考試(+天數)/比賽(+天數)/公告(系統、課程)/其他(加入課程、角色變更、題解審核)。
- Bits UI Switch;天數 number input,對應開關關閉時 disable。
- form action + superForm,Zod schema 在 `@nojv/core`,`consumeFormRateLimit`,upsert 單 row。
- paraglide 雙語 messages(改後 `paraglide:compile`)。

## 部署

- migration:新表 `NotificationPreference` + `NotificationType` 加兩個值。
- prod:SSH 進 prod(`ssh nn@ssh.nojv.tw`)把 SMTP env(Gmail 憑證)加進 worker 的 k8s secret / Helm values,隨 Flux rollout 生效。
