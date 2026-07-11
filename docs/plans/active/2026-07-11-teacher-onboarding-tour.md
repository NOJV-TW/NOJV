# Teacher Onboarding Tour

driver.js 頁面導覽延伸到教師與課程 TA，涵蓋完整備課旅程；成員管理區加常駐 question icon 說明加學生流程。

## Goals

- platform 教師首次登入依頁面觸發導覽：建課 → 加學生 → 出題（含測資與發布）→ 作業/考試 → 監看 → 成績總表。
- 課程 TA（platformRole 為 student）也能看到管理類章節。
- 成員管理面板有常駐說明（question icon），不只一次性導覽。
- 不破壞既有學生導覽與 e2e。

## Architecture

### 引擎泛化（`apps/web/src/lib/onboarding/`）

- 把 `student-tour.ts` 的通用部分（`step`、`runIntro`、`maybeRunIntro`、`scheduleIntro`、seen-state、`BASE` config、singleton `active`/`pendingTimer`/`uid`）抽成 `engine.ts`。singleton 只能有一份，兩個 tour 共用同一引擎避免互搶。
- `student-tour.ts` 與新的 `teacher-tour.ts` 只剩各自 `INTROS` 註冊表 + `onXxxNavigate`/`replayXxxTour` 薄封裝。
- intro key 帶角色前綴（`teacher-nav`…），既有學生 key 不變（不使已看過的學生重看）。重播只清自己註冊表的 key，不能用 `clearAllSeen` 全洗。
- `maybeRunIntro` 開頭檢查 `localStorage.getItem("nojv:tour:off") === "1"` 直接 return（e2e 總開關）。

### 觸發

- `(app)/+layout.svelte`：`platformRole === "teacher"` → 教師註冊表。
- 課程 TA：不查課程角色。把管理類 intro（下表 3、5、6、7、8）附加到學生註冊表尾端；錨點全掛在 manager-only UI 上，非 TA 學生因 `step()` 的 selector-skip 天然跳過。零後端改動。
- admin 不觸發（維持現狀）。

### settings 重播

`settings/+page.svelte` 重播區塊 gate 從 `platformRole === "student"` 放寬為 student/teacher，依角色呼叫對應 replay；replay 走註冊表第一項而非寫死 `"nav"`。

## Intros（依頁面觸發，同頁完成後自動接續）

| # | key | 路徑 | 步驟（錨點 → 文案要點） |
|---|---|---|---|
| 1 | `teacher-nav` | `/dashboard` | `nav-primary` 歡迎（教師視角）→ `nav-courses`（作業/考試/成績都從課程進——教師導航列沒有作業/考試連結）→ `nav-problems` → `nav-submissions` → `welcome-guide`（新；零活動教師必渲染，CTA 直達建課）。**不用 `dashboard-*`**（零活動不渲染）。 |
| 2 | `teacher-courses` | `/courses` | `courses-managing` tab → `courses-create` 建立課程（空狀態時錨 CTA，selector-skip 自動擇一）。 |
| 3 | `teacher-members` | `/courses/[id]/members` | `course-tabs`（課程殼層：總覽/作業/考試/成績/成員/分析/設定）→ `members-bulk-add`（**輸入學號**，一行一個或逗號分隔；未註冊也可先加，會建佔位帳號）→ `members-role`（學生/TA）→ 提醒：**請學生用學校信箱（ntnu/ntu/ntust）登入註冊，系統自動以學號連結；用其他信箱註冊的學生需再完成學校信箱驗證**。 |
| 4 | `teacher-problems` | `/problems` | `problems-mine` tab → `problems-create`（標準/進階）。 |
| 5 | `teacher-problem-edit` | `/problems/[id]/edit` | `edit-rail`（基本資訊先存檔才解鎖測資/評測）→ `testcase-upload`（ZIP 檔名 `(\d\d)(\d\d)` 自動分 subtask 與配分）→ `problem-publish`（無測資不能發布是刻意閘門；題號發布時配發）。 |
| 6 | `teacher-assignment-new` | `/courses/[id]/assignments/new` | `assignment-picker`（僅已發布題）→ `assignment-schedule`（開放/截止/關閉）→ `assignment-publish`（草稿 vs 發布；草稿僅課程管理者可見）。 |
| 7 | `teacher-monitor` | `/assignments/[id]`（管理模式） | `manage-tabs`（提交/結果/抄襲/提問/稽核）→ `manage-matrix`（學生×題目矩陣）。 |
| 8 | `teacher-gradebook` | `/courses/[id]/grades` | `gradebook`（每題顆粒度）→ `gradebook-export`（CSV）。 |

## 常駐說明（question icon）

`BulkHandleAddPanel` 學號欄位 label 旁加現成 `HelpTooltip`（primitives/ui），多行文案同上章節 3 的加學生說明（學號格式、佔位帳號、請學生用學校信箱註冊或完成學校信箱驗證）。

## i18n

- `tour_teacher_*Title/Body` 與 tooltip 文案成對加進 `apps/web/messages/en.json` + `zh-TW.json`，沿用 `tour_next/prev/done`。
- 改完必跑 `pnpm --filter @nojv/web paraglide:compile`。
- 順修錯誤文案：`tour_student_coursesBody` 稱「用老師給的邀請碼加入課程」——課程無邀請碼（老師手動加人），改為正確描述。

## 新增 data-tour 錨點

| 錨點 | 檔案 |
|---|---|
| `welcome-guide` | `features/dashboard/WelcomeGuide.svelte`（staff 卡片） |
| `courses-managing`、`courses-create` | `routes/(app)/courses/+page.svelte` |
| `course-tabs` | `features/course/CourseTabBar.svelte` |
| `members-bulk-add`、`members-role` | `features/course/BulkHandleAddPanel.svelte` |
| `problems-mine`、`problems-create` | `features/problem/views/ProblemTabs.svelte` |
| `edit-rail` | `features/problem/views/EditRail.svelte` |
| `testcase-upload` | `features/problem/testcase/TestcaseZipUploader.svelte` |
| `problem-publish` | `routes/(app)/problems/[problemId]/edit/+page.svelte` |
| `assignment-picker`、`assignment-schedule`、`assignment-publish` | `routes/(app)/courses/[courseId]/assignments/new/+page.svelte` |
| `manage-tabs`、`manage-matrix` | `routes/(app)/assignments/[assignmentId]/+page.svelte` |
| `gradebook`、`gradebook-export` | `routes/(app)/courses/[courseId]/grades/+page.svelte` |

## e2e

- 教師導覽會讓既有 teacher e2e（course-manage、problem-lifecycle、assignments…）被 driver.js overlay 擋點擊。
- 對策：auth fixture（teacher/student/new-student）產生時寫入 `nojv:tour:off=1`，引擎總開關直接跳過；同時治好學生測試對 popover 的 flaky 處理。

## Verification

- 每個新錨點用教師帳號在 ≥1024px、全新零活動狀態實機走一遍（`step()` 靜默跳過缺錨點，寫錯 selector 不會報錯）。
- TA 路徑：學生帳號 + 任一課 TA 身分，驗證管理頁觸發、非管理頁不觸發。
- 一般學生：確認不會看到任何 teacher intro。
- `pnpm test:e2e` 全綠（含 tour:off 生效）。
