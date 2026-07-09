# Email 通知功能實作計劃

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 幫既有站內通知加 email 管道 + 使用者偏好(設計見 `2026-07-10-email-notifications-design.md`,先讀它)。

**Architecture:** 新 `NotificationPreference` 表(無 row = 全預設);mailer 抽成 `packages/mailer` 通用 SMTP;email 掛在 `createNotification(Batch)` 內依 type 白名單 fire-and-forget;排程通知改 checkpoint 制(目標時間 − N 天,N=7…1,醒來才讀偏好)。

**Tech Stack:** Prisma 7、Temporal workflow(deterministic!)、nodemailer、SvelteKit form action + superForm、Bits UI Dialog/Switch、paraglide。

**Conventions(全程遵守):**
- 不寫註解。TDD:先寫測試看它 fail 再實作。每個 task 結尾 commit。
- 測試放置與跑法見 `docs/runbooks/testing.md`。unit: `pnpm test:unit`,integration: `pnpm test:integration`(需本機 stack)。
- schema 改動後:`pnpm db:generate`;dev DB 用 `pnpm db:push`(**不可** `migrate dev`);prod migration 手寫 SQL 檔(參考 `packages/db/prisma/migrations/` 既有格式,並跑 `node scripts/check-migrations.mjs` 驗證)。
- schema 文件:`node scripts/generate-schema-docs.mjs`(CI 有 diff gate)。
- paraglide:改 `apps/web/messages/*.json` 後 `pnpm --filter @nojv/web paraglide:compile`。
- workflow 程式碼內禁用 `Date.now()` 以外的非決定性 API(Temporal 的 `Date.now()` 可用,是 deterministic 版)。

---

### Task 1: Schema — NotificationPreference + 新 NotificationType

**Files:**
- Modify: `packages/db/prisma/schema/notification.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_notification_preference/migration.sql`

**Step 1:** enum `NotificationType` 加 `assignment_started`、`editorial_removed`;新增 model:

```prisma
model NotificationPreference {
  userId                    String  @id
  emailAssignmentStarted    Boolean @default(true)
  emailAssignmentDueSoon    Boolean @default(true)
  assignmentDueSoonLeadDays Int     @default(3)
  emailExamStarting         Boolean @default(true)
  examStartingLeadDays      Int     @default(1)
  emailContestStarting      Boolean @default(true)
  contestStartingLeadDays   Int     @default(1)
  emailSystemAnnouncement   Boolean @default(true)
  emailCourseAnnouncement   Boolean @default(true)
  emailCourseEnrolled       Boolean @default(true)
  emailRoleChanged          Boolean @default(true)
  emailEditorialRemoved     Boolean @default(true)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

(User model 那側要補 relation 欄位,在 `auth.prisma`。)

**Step 2:** 手寫 migration SQL(`ALTER TYPE "NotificationType" ADD VALUE ...` × 2 + `CREATE TABLE`)。注意 Postgres 的 ADD VALUE 不能在同 transaction 內使用新值 —— migration 只加值不使用,安全。

**Step 3:** `pnpm db:generate && pnpm db:push`;`node scripts/check-migrations.mjs`;`node scripts/generate-schema-docs.mjs`。

**Step 4:** 跑 `pnpm --filter @nojv/db test` 若有;commit `feat(db): notification preference table + new notification types`。

---

### Task 2: `packages/mailer` — 通用 SMTP mailer 抽出

**Files:**
- Create: `packages/mailer/`(package.json、tsconfig、src/index.ts、src/template.ts、src/types.ts)— 結構抄 `packages/storage`
- Delete: `apps/web/src/lib/server/mailer/`(gmail.ts/index.ts/template.ts/types.ts)
- Modify: web 內三個 import 點(`shared/school-verification.ts`、`routes/(app)/account/+page.server.ts`、`routes/(app)/account/two-factor/+page.server.ts`)
- Modify: `apps/web/src/lib/server/env.ts`(GMAIL_* → 移除;SMTP 環境改由 mailer package 自讀)
- Modify: `infra/charts/nojv/templates/web.deployment.yaml` + worker deployment templates(env 對映)

**Step 1(test first):** `packages/mailer/src/index.test.ts` — 未設 SMTP env 時 `getMailer()` 回 no-op(sendEmail 不丟錯);設了 env 時建立 transport(mock nodemailer)。

**Step 2:** 實作。env 用 zod 自讀 `process.env`:

```ts
const envSchema = z.object({
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  APP_BASE_URL: z.string().default("https://nojv.tw"),
});
```

`SMTP_HOST` 或 `SMTP_USER` 空 → no-op mailer + 一次性 warning log。`from = SMTP_FROM || \`NOJV <${SMTP_USER}>\``。`template.ts`、`types.ts` 原封搬過去,另 export `getAppBaseUrl()`。lazy singleton(參考原 `getMailer`)。

**Step 3:** web 三處 import 改 `@nojv/mailer`;刪原目錄;web env.ts 移除 GMAIL_*。全 repo grep `GMAIL` 清乾淨(**helm/docs/env-manifest 也要**,`infra/charts/nojv/README.md` 有 env-manifest 說明,worker-judge.deployment.yaml 有 parity 慣例 —— 新 env 一律有 default,不會觸發 required crashloop,但 manifest 文件要同步)。helm:web + worker(platform/judge 兩個 deployment 都看,platform worker 才需要)加 SMTP_* env(secret keys 沿用既有 secret,新增 SMTP_USER/SMTP_PASS keys;values 檔照既有模式)。

**Step 4:** worker 端:`apps/worker` package.json 加 `@nojv/mailer` dep(application 那層引用,見 Task 4 —— 實際 dep 加在 `packages/application`)。

**Step 5:** `pnpm build --filter="./packages/*" && pnpm --filter @nojv/web check && pnpm test:unit`;commit `refactor(mailer): extract @nojv/mailer with generic SMTP transport`。

---

### Task 3: 偏好 repo + core schema + application 存取

**Files:**
- Create: `packages/db/src/repositories/notification-preference.ts`(記得在 repo index export)
- Create: `packages/core/src/notification-preferences.ts`(記得 index export)
- Modify: `packages/application/src/notification/index.ts`(加 getPreferences/updatePreferences)

**Step 1(test first):** core schema 測試 — defaults、leadDays 界線 1–7。

```ts
export const notificationPreferencesSchema = z.object({
  emailAssignmentStarted: z.boolean().default(true),
  emailAssignmentDueSoon: z.boolean().default(true),
  assignmentDueSoonLeadDays: z.number().int().min(1).max(7).default(3),
  emailExamStarting: z.boolean().default(true),
  examStartingLeadDays: z.number().int().min(1).max(7).default(1),
  emailContestStarting: z.boolean().default(true),
  contestStartingLeadDays: z.number().int().min(1).max(7).default(1),
  emailSystemAnnouncement: z.boolean().default(true),
  emailCourseAnnouncement: z.boolean().default(true),
  emailCourseEnrolled: z.boolean().default(true),
  emailRoleChanged: z.boolean().default(true),
  emailEditorialRemoved: z.boolean().default(true),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const DEFAULT_NOTIFICATION_PREFERENCES = notificationPreferencesSchema.parse({});
```

**Step 2:** repo 方法:
- `get(userId)` → row | null
- `upsert(userId, prefs)`
- `getEffectiveMap(userIds: string[]): Promise<Map<string, NotificationPreferences>>` — 一次 `findMany({ where: { userId: { in } } })`,缺 row 的補 `DEFAULT_NOTIFICATION_PREFERENCES`
- integration test(跟既有 repo 測試同層):無 row 回預設、upsert 後回存值。

**Step 3:** application:`getNotificationPreferences(userId)`(schema.parse row ?? {})、`updateNotificationPreferences(userId, input)`(schema.parse 後 upsert)。

**Step 4:** 測試過後 commit `feat(notification): preference storage + effective defaults`。

---

### Task 4: Email 發送層 — 掛進 createNotification(Batch)

**Files:**
- Create: `packages/application/src/notification/email.ts`
- Modify: `packages/application/src/notification/index.ts`
- Modify: `packages/db/src/repositories/notification.ts`(加 `listExistingDedupeKeys(keys: string[]): Promise<Set<string>>`)
- Modify: `packages/db/src/repositories/user.ts`(加 `listEmailByIds(ids)` → `{id, email, emailVerified}[]`,若無等價方法)
- Modify: `packages/application/package.json`(dep `@nojv/mailer`)

**設計:**

```ts
type EmailSpec = {
  prefKey: keyof NotificationPreferences;
  subject: (params: any) => string;
  heading: (params: any) => string;
  intro: (params: any) => string;
};
const EMAIL_SPECS: Partial<Record<NotificationType, EmailSpec>> = {
  assignment_started: {...}, assignment_due_soon: {...},
  exam_starting_soon: {...}, contest_starting_soon: {...},
  announcement_published: {...}, // prefKey 依 params.courseId 有無選 system/course → 用函式覆寫
  course_enrolled: {...}, role_changed: {...}, editorial_removed: {...},
};
// clarification_answered 不在表內 → 永不寄 email
```

文案雙語(中文為主、英文附註,參考既有 template 的 fallback 寫法);subject 例:`【NOJV】作業「${title}」已開始`。announcement 因 system/course 開關不同,prefKey 用 `(params) => params.courseId ? "emailCourseAnnouncement" : "emailSystemAnnouncement"`(把 prefKey 定義成函式統一處理)。announcement 的 params 目前沒有 courseId —— 在 `announcement/mutations.ts` 的 `fanoutAnnouncementPublished` params 補上 `courseId`。

`maybeSendEmails(inputs: NotificationCreateInput[], skippedDedupeKeys: Set<string>)`:
1. 過濾:type 有 spec、dedupeKey 不在 skipped。
2. `getEffectiveMap` 查偏好,prefKey false 的剔除。
3. `userRepo.listEmailByIds` 拿 email,`emailVerified === false` 剔除,placeholder email(`@deleted.nojv.local` 等 synthesize 的)剔除。
4. 逐封 `mailer.sendEmail`,html 用 `renderEmail`,action.url = `getAppBaseUrl() + linkUrl`(linkUrl null 就不放按鈕),outro 固定:`不想收到這類信件?請到 <a href="${base}/account">帳號設定</a> 調整通知偏好。/ Manage your notification preferences in account settings.`
5. 全程 try/catch per-mail,失敗 log 不拋。

**掛法:** `createNotification` / `createNotificationBatch` 內,建站內通知前先 `listExistingDedupeKeys`(只查有 dedupeKey 的 inputs),建完後 `void maybeSendEmails(inputs, existing).catch(log)` —— **不 await**,web 請求路徑不被幾百封信卡住。

**Step 1(test first):** unit test `email.test.ts` — mock mailer + repos:偏好關閉不寄、dedupe 已存在不寄、無 spec type 不寄、announcement courseId 分流、未驗證 email 不寄。
**Step 2:** 實作到測試綠。
**Step 3:** commit `feat(notification): email channel on notification creation`。

---

### Task 5: 排程 fanout 改 checkpoint 制

**Files:**
- Create: `apps/worker/src/workflows/reminder-checkpoints.ts`(純函式,好測)
- Modify: `apps/worker/src/workflows/assignment-due-soon.ts`、`exam-auto-close.ts`、`contest-lifecycle.ts`
- Modify: `apps/worker/src/activities/lifecycle.ts`、`packages/application/src/notification/index.ts`(fanout 簽名加 leadDays;新 `fanoutAssignmentStarted`)
- Modify: `packages/core/src/workflow-types.ts`(`AssignmentDueSoonInput` 加 `opensAt: string`)
- Modify: `packages/application/src/assignment/mutations.ts:193,250`、`shared/lifecycle-reconciler.ts:34`(dispatch 傳 opensAt)
- Test: `apps/worker` 既有 workflow helper 測試同層(參考 `exam-auto-close-helpers` 的測試位置)

**Step 1(test first):** 純函式:

```ts
export interface Checkpoint { atMs: number; leadDays: number }
export function computeReminderCheckpoints(
  targetMs: number, notBeforeMs: number, nowMs: number, maxLeadDays = 7,
): Checkpoint[] {
  const DAY = 86_400_000;
  const out: Checkpoint[] = [];
  for (let n = maxLeadDays; n >= 1; n--) {
    const at = targetMs - n * DAY;
    if (at < notBeforeMs) continue;
    if (at <= nowMs) continue;
    out.push({ atMs: at, leadDays: n });
  }
  return out;
}
```

測:一般 7 天窗口、開始時間吃掉早期 checkpoint(作業長度 < N 天則無該 checkpoint)、now 已過的跳過、全部過期回空。

**Step 2:** workflows(Temporal 內 `Date.now()` 是 deterministic 的,現有 code 就這樣用):

`assignmentDueSoonWorkflow`:
```
opensAtMs = Date.parse(input.opensAt); closesAtMs = Date.parse(input.closesAt)
if (closesAtMs > Date.now()) {
  if (opensAtMs > Date.now()) await sleep(opensAtMs - Date.now())
  await lifecycle.fanoutAssignmentStarted(input.assignmentId)   // dedupe 使重派冪等
}
for (cp of computeReminderCheckpoints(closesAtMs, opensAtMs, Date.now())) {
  const ms = cp.atMs - Date.now(); if (ms > 0) await sleep(ms)
  await lifecycle.fanoutAssignmentDueSoon(input.assignmentId, cp.leadDays)
}
```

`examAutoCloseWorkflow` / `contestLifecycleWorkflow`:把 `START_REMINDER_MINUTES=15` 的單點提醒換成 checkpoint 迴圈(target=startsAt,notBefore=0,即 `-Infinity` 等效;exam 用 `fanoutExamStartingSoon(examId, leadDays)`),之後原本的 start/close 流程不動。

**Step 3:** fanout 改動(application/notification/index.ts):
- `fanoutAssignmentStarted(assignmentId)`:對象 = 課程 active 學生(不濾 maxed);type `assignment_started`;dedupeKey `assignment_started:${id}:${userId}`;linkUrl 同 due_soon。
- `fanoutAssignmentDueSoon(assignmentId, leadDays)`:原邏輯 + 最後用 `getEffectiveMap` 濾 `assignmentDueSoonLeadDays === leadDays`。
- `fanoutExamStartingSoon(examId, leadDays)` / `fanoutContestStartingSoon(contestId, leadDays)`:同樣濾 `examStartingLeadDays` / `contestStartingLeadDays`。
- activities/lifecycle.ts 轉發簽名同步改。

**Step 4(test first 補):** fanout 的 leadDays 過濾加 unit/integration test(既有 fanout 測試在哪就跟著放;若無,加 integration test 驗「pref=3 的人只在 leadDays=3 收到」)。

**Step 5:** dispatch 呼叫端補 `opensAt`(assignment mutations 兩處 + reconciler;查 assignment row 的 opensAt 欄位名,可能是 `opensAt`)。grep `AssignmentDueSoonInput` 確認無漏。

**Step 6:** `pnpm test:unit && pnpm --filter @nojv/worker check`;commit `feat(worker): checkpoint-based reminders with per-user lead days`。

---

### Task 6: editorial_removed 通知

**Files:**
- Modify: `packages/application/src/editorial/reports.ts`(`resolveEditorialReport` action==="resolve" 分支)

softDelete 前先 `editorialRepo.findById(report.editorialId)` 拿 title/problemId/userId,softDelete 後:

```ts
await notificationDomain.createNotification({
  userId: editorial.userId,
  type: "editorial_removed",
  params: { problemId: editorial.problemId, title: editorial.title },
  linkUrl: `/problems/${editorial.problemId}`,
});
```

(linkUrl 路由格式先 grep 確認,problem 路由可能吃 displayId。)test first:resolve 產生通知、dismiss 不產生。commit `feat(editorial): notify author when editorial removed via report`。

---

### Task 7: 設定 UI — /account 欄位 + Modal

**Files:**
- Modify: `apps/web/src/routes/(app)/account/+page.server.ts`(load 回 prefs + superForm;action `updateNotificationPreferences`,套 `consumeFormRateLimit`)
- Modify: `apps/web/src/routes/(app)/account/+page.svelte`(新列)
- Create: `apps/web/src/lib/components/features/account/NotificationPreferencesDialog.svelte`(目錄不存在就看 features/ 下慣例放)
- Modify: `apps/web/messages/en.json`、`zh-tw.json`

**先讀:** account `+page.svelte` 的 security link-card 樣式、`CourseAnnouncementDialog.svelte` 的 Dialog 用法、任一 superForm action 寫法。

**內容:** 列樣式沿用 securityLinkClass 但改 `<button>` 開 Dialog。Dialog 分組:作業(started 開關;due_soon 開關 + leadDays number 1–7)/考試(開關+leadDays)/比賽(開關+leadDays)/公告(系統、課程)/其他(加入課程、角色變更、題解移除)。Switch 用 Bits UI;leadDays input 在開關 off 時 `disabled`。注意 Svelte 5 runes + `exactOptionalPropertyTypes`(可選 prop 寫 `?: T | undefined`)。

server:zod schema 直接用 `@nojv/core` 的 `notificationPreferencesSchema`;成功後 toast(照既有 account action 模式)。

**驗證:** `pnpm --filter @nojv/web paraglide:compile && pnpm --filter @nojv/web check`;手動:dev server 開 /account 操作 modal 存檔再開確認回填。commit `feat(web): notification preference settings modal`。

---

### Task 8: 全面驗證 + 文件 + PR

1. `rm -rf node_modules` 級 fresh check 不用,但必跑:`pnpm ci:verify` + `pnpm test:integration`(記憶教訓:ci:verify 只跑 unit)。
2. E2E 冒煙(可選):Playwright 既有 auth fixture 開 /account 動 modal。
3. 文件同步:`docs/architecture/DATABASE.md`(generator)、`docs/architecture/JUDGE_PIPELINE.md` 不動、檢查 `docs/architecture/ARCHITECTURE.md`/`FRONTEND.md` 是否提及 mailer 位置(mailer 搬家要同步)、`docs/operations/DEPLOYMENT.md` 加 SMTP env。doc-link gate 會抓斷鏈。
4. 設計 doc `2026-07-10-email-notifications-design.md` 移入 `docs/plans/completed/`?— 否,PR merge 後才移;本計劃檔一起進 PR。
5. `gh pr create`;CI 綠直接 `gh pr merge --squash --admin --delete-branch`(既有授權);merge 後看 main CI + Flux deploy。

---

### Task 9: Prod env(merge + deploy 後)

`ssh nn@ssh.nojv.tw`:
1. 找既有含 GMAIL_USER 的 secret:`sudo kubectl -n nojv get secret -o name` + describe。
2. 加 SMTP keys(值:SMTP_HOST=smtp.gmail.com、SMTP_PORT=465、SMTP_USER=<gmail>、SMTP_PASS=<app password>,沿用原 GMAIL 值)。
3. Flux rollout 後驗證:web/worker pod env 有 SMTP_*;實測一封(改個偏好、發個測試公告或看 worker log)。

---

## 已知取捨(不要「順手修」)

- Gmail ~500 封/天天花板:接受,transport 已通用化,超限換 SES 只改 env。
- email best-effort:通知建了但信寄失敗不補寄。
- 「題解審核結果」實際系統沒有審核流,實作為「被檢舉移除時通知作者」—— 已向使用者說明的語意轉換。
- clarification_answered 刻意無 email。
- 過期 checkpoint 跳過不補發(舊 due-soon 會立即補發,新行為是刻意改變)。
