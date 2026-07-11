# Teacher Onboarding Tour Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 教師與課程 TA 的 driver.js 頁面導覽（8 個 intro）+ 加學生面板常駐 HelpTooltip，含 e2e 總開關。

**Architecture:** 把 `student-tour.ts` 的通用引擎抽成 `engine.ts`（單一 singleton），student/teacher 各持 `Intro[]` 註冊表由 layout 依 platformRole 注入；TA 靠「管理類 intro 錨在 manager-only UI + selector-skip」自然閘門，零後端改動。設計文件：`docs/plans/active/2026-07-11-teacher-onboarding-tour.md`。

**Tech Stack:** SvelteKit + Svelte 5、driver.js 1.6、paraglide i18n、Bits UI（HelpTooltip 現成）、Playwright。

**完成後：發 PR、不要 merge（使用者指示）。**

**與設計文件的刻意偏差**（已勘查後決定）：

1. 測資上傳步驟併入 `edit-rail` 步驟文案 —— `TestcaseZipUploader` 只在 Testcase 分區啟用時才在 DOM，編輯頁首訪時該分區鎖定，獨立步驟永遠被 skip。不加 `testcase-upload` 錨點。
2. `teacher-monitor` 只有一步，錨在 `#assignment-manage-tab-problems`（Tabs primitive 已渲染此 id，見 `tabs.svelte:56`），文案一次講完管理分頁；提交矩陣在非預設分頁，無法錨定。
3. `gradebook` 步驟錨用現有 `[data-slot="course-gradebook"]`，TA/學生閘門用 `gradebook-export`（`isManager && rows.length > 0` 才渲染，`grades/+page.svelte:79`）。

---

## Task 1: 抽出 tour 引擎 `engine.ts`

**Files:**
- Create: `apps/web/src/lib/onboarding/engine.ts`
- Modify: `apps/web/src/lib/onboarding/student-tour.ts`（重寫為註冊表）

**Step 1: 建立 `engine.ts`**

內容 = 現有 `student-tour.ts` 的通用下半部，差異：`INTROS` 改為模組層 `registry`、`clearAllSeen` 改 `clearSeen(intros)`、加 `nojv:tour:off` 總開關、export `step`/`onTourNavigate`/`replayTour`/`Intro`：

```ts
import { driver, type Config, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { m } from "$lib/paraglide/messages.js";

const SEEN_PREFIX = "nojv:tour:seen:";
const OFF_KEY = "nojv:tour:off";

type Side = "top" | "bottom" | "left" | "right";

export interface Intro {
  key: string;
  pad: number;
  match: (pathname: string) => boolean;
  build: () => DriveStep[];
}

let uid = "";
let registry: Intro[] = [];
let active: Driver | null = null;
let silent = false;
let pendingTimer: number | undefined;

function seenKey(key: string): string {
  return `${SEEN_PREFIX}${uid}:${key}`;
}

function seen(key: string): boolean {
  try {
    return localStorage.getItem(seenKey(key)) === "1";
  } catch {
    return false;
  }
}
function markSeen(key: string) {
  try {
    localStorage.setItem(seenKey(key), "1");
  } catch {
    return;
  }
}
function clearSeen(intros: Intro[]) {
  try {
    for (const intro of intros) localStorage.removeItem(seenKey(intro.key));
  } catch {
    return;
  }
}
function tourOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

const BASE: Config = {
  overlayOpacity: 0.6,
  stageRadius: 12,
  popoverClass: "nojv-tour",
  overlayClickBehavior: "nextStep",
};

export function step(sel: string, title: string, description: string, side: Side): DriveStep[] {
  return typeof document !== "undefined" && document.querySelector(sel)
    ? [{ element: sel, popover: { title, description, side, align: "start" } }]
    : [];
}

function runIntro(key: string, steps: DriveStep[], pad: number) {
  let closedByUser = false;
  let reachedLastStep = false;
  const d = driver({
    ...BASE,
    stagePadding: pad,
    showProgress: steps.length > 1,
    progressText: "{{current}} / {{total}}",
    showButtons: steps.length > 1 ? ["next", "previous", "close"] : ["next", "close"],
    nextBtnText: m.tour_next(),
    prevBtnText: m.tour_prev(),
    doneBtnText: m.tour_done(),
    steps,
    onCloseClick: () => {
      closedByUser = true;
      d.destroy();
    },
    onHighlighted: () => {
      if (d.isLastStep()) reachedLastStep = true;
    },
    onDestroyed: () => {
      if (active === d) active = null;
      markSeen(key);
      if (!silent && !closedByUser && reachedLastStep) {
        scheduleIntro(window.location.pathname, 200);
      }
    },
  });
  active = d;
  d.drive();
}

function maybeRunIntro(pathname: string) {
  if (typeof window === "undefined") return;
  if (tourOff()) return;
  if (active) return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  for (const intro of registry) {
    if (!intro.match(pathname) || seen(intro.key)) continue;
    const steps = intro.build();
    if (steps.length === 0) continue;
    runIntro(intro.key, steps, intro.pad);
    return;
  }
}

function scheduleIntro(pathname: string, delay: number) {
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => maybeRunIntro(pathname), delay);
}

function teardownForNav() {
  window.clearTimeout(pendingTimer);
  if (!active) return;
  silent = true;
  active.destroy();
  silent = false;
}

export function onTourNavigate(pathname: string, userId: string, intros: Intro[]): void {
  if (typeof window === "undefined") return;
  uid = userId;
  registry = intros;
  teardownForNav();
  scheduleIntro(pathname, 350);
}

export function replayTour(userId: string, intros: Intro[]): void {
  if (typeof window === "undefined") return;
  uid = userId;
  registry = intros;
  clearSeen(intros);
  teardownForNav();
  for (const intro of intros) {
    const steps = intro.build();
    if (steps.length > 0) {
      runIntro(intro.key, steps, intro.pad);
      return;
    }
  }
}
```

行為保持：seen key 格式不變（`nojv:tour:seen:{uid}:{key}`，學生既有 key `nav`/`dashboard`/`problems`/`problem` 不動，已看過的學生不會重看）。

**Step 2: 重寫 `student-tour.ts`**

保留四個 steps builder（`navSteps`/`dashboardSteps`/`problemsSteps`/`problemSteps`，內容原封不動），移除引擎程式碼，改為：

```ts
import type { DriveStep } from "driver.js";
import { m } from "$lib/paraglide/messages.js";
import { replayTour, step, type Intro } from "./engine";

const PROBLEM_DETAIL = /^\/problems\/[^/]+$/;

// …四個 steps builder 原樣搬入，step 改 import 自 engine …

export const studentIntros: Intro[] = [
  { key: "nav", pad: 2, match: (p) => p === "/dashboard", build: navSteps },
  { key: "dashboard", pad: 6, match: (p) => p === "/dashboard", build: dashboardSteps },
  { key: "problems", pad: 6, match: (p) => p === "/problems", build: problemsSteps },
  { key: "problem", pad: 4, match: (p) => PROBLEM_DETAIL.test(p), build: problemSteps },
];

export function replayStudentTour(userId: string): void {
  replayTour(userId, studentIntros);
}
```

`onStudentNavigate` 刪除（Task 6 改 layout 用 `onTourNavigate`）。注意：layout 在 Task 6 前仍 import `onStudentNavigate`，因此 **Task 1 先不能跑 check**；Task 1 與 Task 6 之間以 Task 6 的 check 驗證。若想每步都綠，可暫時保留 `onStudentNavigate` 包裝（`onTourNavigate(pathname, userId, studentIntros)`）到 Task 6 再刪。採後者：保留暫時包裝。

**Step 3: 驗證編譯**

Run: `pnpm --filter @nojv/web check`
Expected: 0 errors（既有 baseline）。

**Step 4: Commit**

```bash
git add apps/web/src/lib/onboarding/
git commit -m "refactor(web): extract role-agnostic tour engine from student tour"
```

---

## Task 2: i18n 文案（en + zh-TW）

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/zh-TW.json`

**Step 1: 修錯誤文案 `tour_student_coursesBody`**

en.json line 1903：
```json
"tour_student_coursesBody": "Once your teacher adds you to a course, its assignments and exams show up here.",
```
zh-TW.json line 1888：
```json
"tour_student_coursesBody": "老師把你加入課程後，課程的作業與考試都會出現在這裡。",
```
（原文說「邀請碼加入課程」——平台沒有課程邀請碼，老師手動加人。）

**Step 2: 新增 `members_handlesHelp`（HelpTooltip 用）**

插在 `members_handlesLabel` 相鄰處（兩檔同位置）：

en.json：
```json
"members_handlesHelp": "One student ID per line, or comma-separated.\nStudents who haven't registered yet get a placeholder account.\nAsk students to sign up with their school email and verify it — their accounts link to the course automatically.",
```
zh-TW.json：
```json
"members_handlesHelp": "一行一個學號，或用逗號分隔。\n還沒註冊的學生會先建立佔位帳號。\n請學生用學校信箱登入註冊並完成驗證，帳號會自動連結到課程。",
```

**Step 3: 新增 `tour_teacher_*` 區塊**

插在 `tour_student_dashRecentBody` 之後、`upload_acceptedFileTypes` 之前（en.json 1931/1932 之間；zh-TW.json 1916/1917 之間）。

en.json：
```json
"tour_teacher_welcomeTitle": "Welcome to NOJV",
"tour_teacher_welcomeBody": "This is your teaching workspace. Take a minute to see the full flow — create a course, add students, author problems, assign work, and track grades. Replay anytime from Settings.",
"tour_teacher_coursesNavTitle": "Courses",
"tour_teacher_coursesNavBody": "Your home base. Assignments, exams, grades, and member management all live inside each course.",
"tour_teacher_problemsNavTitle": "Problems",
"tour_teacher_problemsNavBody": "Author and manage problems here. Once published, your problems can be attached to assignments and exams.",
"tour_teacher_submissionsNavTitle": "Submissions",
"tour_teacher_submissionsNavBody": "Your own submissions live here; to see students' work, open the course or assignment pages.",
"tour_teacher_welcomeGuideTitle": "Start with a course",
"tour_teacher_welcomeGuideBody": "First time here? Create your first course — the tour will guide you through the rest as you go.",
"tour_teacher_managingTitle": "Courses you manage",
"tour_teacher_managingBody": "This tab lists the courses you manage.",
"tour_teacher_createCourseTitle": "Create a course",
"tour_teacher_createCourseBody": "Click here to create a course — just a title and a semester.",
"tour_teacher_courseTabsTitle": "Course sections",
"tour_teacher_courseTabsBody": "Everything in a course starts from this bar: overview, assignments, exams, grades, and members — managers also get analytics and settings.",
"tour_teacher_bulkAddTitle": "Add students",
"tour_teacher_bulkAddBody": "Enter student IDs here, one per line or comma-separated. You can add students before they register — each gets a placeholder account. Remind students to sign up with their school email and verify it; their accounts link to the course automatically.",
"tour_teacher_memberRoleTitle": "Student or TA",
"tour_teacher_memberRoleBody": "Choose the role to add. TAs can manage course content but cannot change members.",
"tour_teacher_myProblemsTitle": "My problems",
"tour_teacher_myProblemsBody": "Problems you authored live in this tab, including unpublished drafts.",
"tour_teacher_createProblemTitle": "Create a problem",
"tour_teacher_createProblemBody": "Start a new problem here. Standard covers most problems; use advanced mode only for custom judging environments.",
"tour_teacher_editRailTitle": "Editor sections",
"tour_teacher_editRailBody": "Problem editing is split into sections. Save the basic info first — test data and judge settings unlock after that. Upload test data as a ZIP: filenames like 0101, 0102 split into subtasks with weights automatically.",
"tour_teacher_publishTitle": "Publish",
"tour_teacher_publishBody": "Publishing needs at least one test set; the problem number is assigned on publish. Published problems can be attached to assignments and exams.",
"tour_teacher_pickProblemsTitle": "Pick problems",
"tour_teacher_pickProblemsBody": "Choose from your published problems to include in this assignment.",
"tour_teacher_scheduleTitle": "Set the schedule",
"tour_teacher_scheduleBody": "Set the open, due, and close times — the platform opens and closes the assignment automatically.",
"tour_teacher_assignPublishTitle": "Draft or publish",
"tour_teacher_assignPublishBody": "Drafts are visible only to course managers; students see the assignment once you publish.",
"tour_teacher_manageTabsTitle": "Manage the assignment",
"tour_teacher_manageTabsBody": "Monitor everything from these tabs: the submissions matrix, results, plagiarism checks, student questions, and the audit log.",
"tour_teacher_gradebookTitle": "Gradebook",
"tour_teacher_gradebookBody": "Every student's score on every problem, at a glance.",
"tour_teacher_gradebookExportTitle": "Export CSV",
"tour_teacher_gradebookExportBody": "Export grades as CSV for further processing or your school system.",
```

zh-TW.json：
```json
"tour_teacher_welcomeTitle": "歡迎來到 NOJV",
"tour_teacher_welcomeBody": "這裡是你的教學工作台。花一分鐘認識備課的完整路徑——建課、加學生、出題、指派作業、看成績。之後隨時能在設定頁重看。",
"tour_teacher_coursesNavTitle": "課程",
"tour_teacher_coursesNavBody": "你的主場。作業、考試、成績與成員管理都在各課程頁裡。",
"tour_teacher_problemsNavTitle": "題庫",
"tour_teacher_problemsNavBody": "出題與管理題目的地方。題目發布後就能掛進作業與考試。",
"tour_teacher_submissionsNavTitle": "提交紀錄",
"tour_teacher_submissionsNavBody": "這裡是你自己的提交；要看學生的作答，請到課程或作業頁。",
"tour_teacher_welcomeGuideTitle": "從建立課程開始",
"tour_teacher_welcomeGuideBody": "第一次使用嗎？先建立你的第一門課程，接下來的導覽會沿路帶你完成備課。",
"tour_teacher_managingTitle": "管理中的課程",
"tour_teacher_managingBody": "這個分頁列出你管理的課程。",
"tour_teacher_createCourseTitle": "建立課程",
"tour_teacher_createCourseBody": "點這裡建立新課程，填上名稱與學期就完成了。",
"tour_teacher_courseTabsTitle": "課程功能區",
"tour_teacher_courseTabsBody": "課程的一切從這排分頁進入：總覽、作業、考試、成績、成員；管理者還有分析與設定。",
"tour_teacher_bulkAddTitle": "加入學生",
"tour_teacher_bulkAddBody": "在這裡輸入學生學號，一行一個或用逗號分隔。還沒註冊的學生也可以先加，系統會建立佔位帳號。記得請學生用學校信箱登入註冊並完成驗證，帳號會自動連結到課程。",
"tour_teacher_memberRoleTitle": "學生或助教",
"tour_teacher_memberRoleBody": "選擇加入的身分。助教可以管理課程內容，但不能變更成員。",
"tour_teacher_myProblemsTitle": "我的題目",
"tour_teacher_myProblemsBody": "你出的題目都在這個分頁，包含還沒發布的草稿。",
"tour_teacher_createProblemTitle": "建立題目",
"tour_teacher_createProblemBody": "點這裡開新題。一般題目選「標準」；需要自訂評測環境再用進階模式。",
"tour_teacher_editRailTitle": "編輯分區",
"tour_teacher_editRailBody": "題目編輯分成幾個區塊。先填好基本資訊並儲存草稿，測資與評測設定才會解鎖。測資用 ZIP 上傳，檔名如 0101、0102 會自動分組成子任務並配分。",
"tour_teacher_publishTitle": "發布題目",
"tour_teacher_publishBody": "至少要有一組測資才能發布，題號會在發布時配發。發布後就能掛進作業與考試。",
"tour_teacher_pickProblemsTitle": "挑選題目",
"tour_teacher_pickProblemsBody": "從你已發布的題目中，挑選要放進這份作業的題目。",
"tour_teacher_scheduleTitle": "設定時程",
"tour_teacher_scheduleBody": "設定開放、截止與關閉時間，系統會依時程自動開放與收卷。",
"tour_teacher_assignPublishTitle": "草稿與發布",
"tour_teacher_assignPublishBody": "存成草稿只有課程管理者看得到；發布後學生才會看到這份作業。",
"tour_teacher_manageTabsTitle": "作業管理",
"tour_teacher_manageTabsBody": "在這排分頁監看作業：提交矩陣、成績結果、抄襲偵測、學生提問與操作紀錄。",
"tour_teacher_gradebookTitle": "成績總表",
"tour_teacher_gradebookBody": "全班每一題的得分一目了然。",
"tour_teacher_gradebookExportTitle": "匯出 CSV",
"tour_teacher_gradebookExportBody": "把成績匯出成 CSV，方便進一步計算或匯入校務系統。",
```

**Step 4: 編譯 + 驗證**

Run: `pnpm --filter @nojv/web paraglide:compile`
Expected: `Successfully compiled inlang project.`

**Step 5: Commit**

```bash
git add apps/web/messages/
git commit -m "feat(web): teacher tour copy, bulk-add help text, fix stale invite-code copy"
```

---

## Task 3: 單元測試（先寫、先紅）+ `teacher-tour.ts`

**Files:**
- Create: `tests/unit/web/onboarding-tours.test.ts`
- Create: `apps/web/src/lib/onboarding/teacher-tour.ts`

**Step 1: 寫失敗測試**

```ts
import { describe, expect, it } from "vitest";
import { studentIntros } from "$lib/onboarding/student-tour";
import { taIntros, teacherIntros } from "$lib/onboarding/teacher-tour";

describe("tour registries", () => {
  it("teacher intro keys are prefixed and disjoint from student keys", () => {
    const studentKeys = new Set(studentIntros.map((i) => i.key));
    for (const intro of teacherIntros) {
      expect(intro.key).toMatch(/^teacher-/);
      expect(studentKeys.has(intro.key)).toBe(false);
    }
  });

  it("routes teacher pages to the right intro", () => {
    const at = (p: string) => teacherIntros.filter((i) => i.match(p)).map((i) => i.key);
    expect(at("/dashboard")).toEqual(["teacher-nav"]);
    expect(at("/courses")).toEqual(["teacher-courses"]);
    expect(at("/courses/abc123/members")).toEqual(["teacher-members"]);
    expect(at("/problems")).toEqual(["teacher-problems"]);
    expect(at("/problems/abc123")).toEqual([]);
    expect(at("/problems/abc123/edit")).toEqual(["teacher-problem-edit"]);
    expect(at("/courses/abc123/assignments/new")).toEqual(["teacher-assignment-new"]);
    expect(at("/assignments/xyz")).toEqual(["teacher-monitor"]);
    expect(at("/courses/abc123/grades")).toEqual(["teacher-gradebook"]);
  });

  it("TA registry contains only management intros", () => {
    expect(taIntros.map((i) => i.key)).toEqual([
      "teacher-members",
      "teacher-problem-edit",
      "teacher-assignment-new",
      "teacher-monitor",
      "teacher-gradebook",
    ]);
  });
});
```

（測試環境設定比照 `tests/unit/web/` 既有檔案——若該目錄慣例是檔頭 `// @vitest-environment jsdom` 或 vitest config 已設，照抄同目錄做法。）

**Step 2: 跑測試確認紅**

Run: `pnpm vitest run --project unit tests/unit/web/onboarding-tours.test.ts`
Expected: FAIL — `Cannot find module '$lib/onboarding/teacher-tour'`。

**Step 3: 建立 `teacher-tour.ts`**

```ts
import type { DriveStep } from "driver.js";
import { m } from "$lib/paraglide/messages.js";
import { replayTour, step, type Intro } from "./engine";

const MEMBERS = /^\/courses\/[^/]+\/members$/;
const PROBLEM_EDIT = /^\/problems\/[^/]+\/edit$/;
const ASSIGNMENT_NEW = /^\/courses\/[^/]+\/assignments\/new$/;
const ASSIGNMENT_DETAIL = /^\/assignments\/[^/]+$/;
const GRADES = /^\/courses\/[^/]+\/grades$/;

function navSteps(): DriveStep[] {
  return [
    ...step('[data-tour="nav-primary"]', m.tour_teacher_welcomeTitle(), m.tour_teacher_welcomeBody(), "bottom"),
    ...step('[data-tour="nav-courses"]', m.tour_teacher_coursesNavTitle(), m.tour_teacher_coursesNavBody(), "bottom"),
    ...step('[data-tour="nav-problems"]', m.tour_teacher_problemsNavTitle(), m.tour_teacher_problemsNavBody(), "bottom"),
    ...step('[data-tour="nav-submissions"]', m.tour_teacher_submissionsNavTitle(), m.tour_teacher_submissionsNavBody(), "bottom"),
    ...step('[data-tour="welcome-guide"]', m.tour_teacher_welcomeGuideTitle(), m.tour_teacher_welcomeGuideBody(), "bottom"),
  ];
}

function coursesSteps(): DriveStep[] {
  return [
    ...step('[data-tour="courses-managing"]', m.tour_teacher_managingTitle(), m.tour_teacher_managingBody(), "bottom"),
    ...step('[data-tour="courses-create"]', m.tour_teacher_createCourseTitle(), m.tour_teacher_createCourseBody(), "bottom"),
  ];
}

function membersSteps(): DriveStep[] {
  const bulkAdd = step('[data-tour="members-bulk-add"]', m.tour_teacher_bulkAddTitle(), m.tour_teacher_bulkAddBody(), "right");
  if (bulkAdd.length === 0) return [];
  return [
    ...step('[data-tour="course-tabs"]', m.tour_teacher_courseTabsTitle(), m.tour_teacher_courseTabsBody(), "bottom"),
    ...bulkAdd,
    ...step('[data-tour="members-role"]', m.tour_teacher_memberRoleTitle(), m.tour_teacher_memberRoleBody(), "left"),
  ];
}

function problemsSteps(): DriveStep[] {
  return [
    ...step('[data-tour="problems-mine"]', m.tour_teacher_myProblemsTitle(), m.tour_teacher_myProblemsBody(), "bottom"),
    ...step('[data-tour="problems-create"]', m.tour_teacher_createProblemTitle(), m.tour_teacher_createProblemBody(), "bottom"),
  ];
}

function problemEditSteps(): DriveStep[] {
  return [
    ...step('[data-tour="edit-rail"]', m.tour_teacher_editRailTitle(), m.tour_teacher_editRailBody(), "right"),
    ...step('[data-tour="problem-publish"]', m.tour_teacher_publishTitle(), m.tour_teacher_publishBody(), "right"),
  ];
}

function assignmentNewSteps(): DriveStep[] {
  return [
    ...step('[data-tour="assignment-picker"]', m.tour_teacher_pickProblemsTitle(), m.tour_teacher_pickProblemsBody(), "right"),
    ...step('[data-tour="assignment-schedule"]', m.tour_teacher_scheduleTitle(), m.tour_teacher_scheduleBody(), "top"),
    ...step('[data-tour="assignment-publish"]', m.tour_teacher_assignPublishTitle(), m.tour_teacher_assignPublishBody(), "top"),
  ];
}

function monitorSteps(): DriveStep[] {
  return step("#assignment-manage-tab-problems", m.tour_teacher_manageTabsTitle(), m.tour_teacher_manageTabsBody(), "bottom");
}

function gradebookSteps(): DriveStep[] {
  const exportBtn = step('[data-tour="gradebook-export"]', m.tour_teacher_gradebookExportTitle(), m.tour_teacher_gradebookExportBody(), "left");
  if (exportBtn.length === 0) return [];
  return [
    ...step('[data-slot="course-gradebook"]', m.tour_teacher_gradebookTitle(), m.tour_teacher_gradebookBody(), "top"),
    ...exportBtn,
  ];
}

const INTROS: Intro[] = [
  { key: "teacher-nav", pad: 2, match: (p) => p === "/dashboard", build: navSteps },
  { key: "teacher-courses", pad: 4, match: (p) => p === "/courses", build: coursesSteps },
  { key: "teacher-members", pad: 6, match: (p) => MEMBERS.test(p), build: membersSteps },
  { key: "teacher-problems", pad: 4, match: (p) => p === "/problems", build: problemsSteps },
  { key: "teacher-problem-edit", pad: 4, match: (p) => PROBLEM_EDIT.test(p), build: problemEditSteps },
  { key: "teacher-assignment-new", pad: 6, match: (p) => ASSIGNMENT_NEW.test(p), build: assignmentNewSteps },
  { key: "teacher-monitor", pad: 6, match: (p) => ASSIGNMENT_DETAIL.test(p), build: monitorSteps },
  { key: "teacher-gradebook", pad: 6, match: (p) => GRADES.test(p), build: gradebookSteps },
];

const TA_KEYS = new Set([
  "teacher-members",
  "teacher-problem-edit",
  "teacher-assignment-new",
  "teacher-monitor",
  "teacher-gradebook",
]);

export const teacherIntros: Intro[] = INTROS;
export const taIntros: Intro[] = INTROS.filter((i) => TA_KEYS.has(i.key));

export function replayTeacherTour(userId: string): void {
  replayTour(userId, teacherIntros);
}
```

閘門說明（重要，防一般學生看到管理 intro）：
- `teacher-members` / `teacher-gradebook` 的 build 以 manager-only 錨（`members-bulk-add` / `gradebook-export`）為前置條件，缺了整個 intro 回空。
- `teacher-assignment-new`（非管理者 302）、`teacher-monitor`（`#assignment-manage-*` 只在 teacher mode 渲染）、`teacher-problem-edit`（只有作者能開）靠頁面可達性天然閘門。

**Step 4: 跑測試確認綠**

Run: `pnpm vitest run --project unit tests/unit/web/onboarding-tours.test.ts`
Expected: 3 passed。

**Step 5: Commit**

```bash
git add apps/web/src/lib/onboarding/teacher-tour.ts tests/unit/web/onboarding-tours.test.ts
git commit -m "feat(web): teacher/TA tour intro registry with management-page gating"
```

---

## Task 4: data-tour 錨點（8 檔）

**Files（全部只加屬性或小包裝，不動邏輯）:**

1. `apps/web/src/lib/components/features/dashboard/WelcomeGuide.svelte:57`
   ```svelte
   <Card variant="surface" size="lg" data-tour="welcome-guide">
   ```
   （Card root 轉發 `restProps`，`card.svelte:59`。）

2. `apps/web/src/routes/(app)/courses/+page.svelte`
   - line 72 tab `<button>`（`{#each}` 內共用）加：
     ```svelte
     data-tour={tab.key === "managing" ? "courses-managing" : undefined}
     ```
   - line 94 建立按鈕：`<Button href="/courses/new" data-tour="courses-create">`
   - line 113（空狀態 wrapper）：`<div class="animate-in animate-in-2" data-tour="courses-create">`
     （兩者互斥或同現皆可，querySelector 取第一個。）

3. `apps/web/src/lib/components/features/course/CourseTabBar.svelte:84`
   `<nav data-slot="course-tab-bar" data-tour="course-tabs" …>`

4. `apps/web/src/lib/components/features/course/BulkHandleAddPanel.svelte`
   - line 90：`<div data-tour="members-bulk-add">`
   - line 124：`<fieldset data-tour="members-role">`

5. `apps/web/src/lib/components/features/problem/views/ProblemTabs.svelte`
   - 「我的題目」pill（line 144 `<button>`，`showCreate` 區塊內）加 `data-tour="problems-mine"`
   - 包住兩顆建立按鈕的 split-button wrapper `<div>`（緊鄰 line 156 `<Button>` 的上一層）加 `data-tour="problems-create"`

6. `apps/web/src/lib/components/features/problem/views/EditRail.svelte:12`
   `<aside data-tour="edit-rail" …>`

7. `apps/web/src/routes/(app)/problems/[problemId]/edit/+page.svelte:334`
   railActions 內的發布鈕（`common_saveDraft` 按鈕之後、`admin_publishTooltip` 之前那顆）加 `data-tour="problem-publish"`。
   ⚠️ 同檔 line 234 有一顆長得一樣的發布鈕（advanced 區、鄰近 `admin_advancedPublishHint`）——不要動那顆，用周邊文案區分。

8. `apps/web/src/routes/(app)/courses/[courseId]/assignments/new/+page.svelte`
   - line 94 `<ExamProblemPicker …>` 外包一層：`<div data-tour="assignment-picker">…</div>`
   - line 119：`<div class="grid gap-5 md:grid-cols-3" data-tour="assignment-schedule">`
   - line 291 發布鈕：`<Button type="submit" formaction="?/publish" disabled={$submitting} data-tour="assignment-publish">`

9. `apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte:80`
   `<Button variant="outline" size="sm" onclick={exportCsv} data-tour="gradebook-export">`

（`teacher-monitor` 用現有 `#assignment-manage-tab-problems`、gradebook 主步驟用現有 `data-slot="course-gradebook"`，無須改檔。）

**Step 2: 驗證**

Run: `pnpm --filter @nojv/web check && pnpm lint`
Expected: 0 errors。

**Step 3: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): data-tour anchors for teacher onboarding tour"
```

---

## Task 5: BulkHandleAddPanel 常駐 HelpTooltip

**Files:**
- Modify: `apps/web/src/lib/components/features/course/BulkHandleAddPanel.svelte`

**Step 1:** import 加 `import HelpTooltip from "$lib/components/primitives/ui/HelpTooltip.svelte";`，label（line 91–93）改：

```svelte
<label class="text-body-sm font-medium" for="bulk-handles">
  {m.members_handlesLabel()}
  <HelpTooltip text={m.members_handlesHelp()} />
</label>
```

（`members_handlesHelp` 的 `\n` 由 HelpTooltip 的 `whitespace-pre-line` 呈現。）

**Step 2:** `pnpm --filter @nojv/web check` → 0 errors。

**Step 3: Commit**

```bash
git add apps/web/src/lib/components/features/course/BulkHandleAddPanel.svelte
git commit -m "feat(web): persistent help tooltip on bulk student add panel"
```

---

## Task 6: layout 觸發 + settings 重播

**Files:**
- Modify: `apps/web/src/routes/(app)/+layout.svelte:10-17`
- Modify: `apps/web/src/routes/(app)/settings/+page.svelte`
- Modify: `apps/web/src/lib/onboarding/student-tour.ts`（刪暫時的 `onStudentNavigate`）

**Step 1: layout**

```svelte
import { onTourNavigate } from "$lib/onboarding/engine";
import { studentIntros } from "$lib/onboarding/student-tour";
import { taIntros, teacherIntros } from "$lib/onboarding/teacher-tour";

afterNavigate(() => {
  const sessionUser = page.data.user;
  if (!sessionUser) return;
  if (sessionUser.platformRole === "teacher") {
    onTourNavigate(page.url.pathname, sessionUser.id, teacherIntros);
  } else if (sessionUser.platformRole === "student") {
    onTourNavigate(page.url.pathname, sessionUser.id, [...studentIntros, ...taIntros]);
  }
});
```

**Step 2: settings（line 121 gate + onclick）**

```svelte
{#if data.platformRole === "student" || data.platformRole === "teacher"}
```
onclick 改：
```svelte
onclick={() => {
  const sessionUser = page.data.user;
  if (!sessionUser) return;
  if (data.platformRole === "teacher") replayTeacherTour(sessionUser.id);
  else replayStudentTour(sessionUser.id);
}}
```
import 補 `replayTeacherTour`。

**Step 3: 刪 `onStudentNavigate` 暫時包裝**，確認全 repo 無殘留引用：
Run: `grep -rn "onStudentNavigate" apps/ tests/` → 無結果。

**Step 4:** `pnpm --filter @nojv/web check && pnpm lint` → 0 errors。

**Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): wire teacher and TA tours into layout and settings replay"
```

---

## Task 7: e2e 總開關

**Files:**
- Modify: `tests/setup/playwright-global-setup.ts`
- Modify: `tests/e2e/dashboard.test.ts:53-61`

**Step 1:** global setup 迴圈內、`waitForURL` 之後加：

```ts
await page.evaluate(() => localStorage.setItem("nojv:tour:off", "1"));
```

（storageState 會把 localStorage 一併存進 fixture，四個角色都涵蓋。）

**Step 2:** `dashboard.test.ts` 的 tour-dismiss 舞步（lines 53–61，`driver-popover` 等待+關閉）替換為 hydration 等待：

```ts
await page.waitForTimeout(3000);
```

並 `grep -rn "driver-popover" tests/e2e/` 確認無其他殘留（有就一併替換）。

**Step 3: Commit**

```bash
git add tests/
git commit -m "test(e2e): disable onboarding tours via nojv:tour:off in auth fixtures"
```

---

## Task 8: 文件同步

**Step 1:** `grep -rn "tour\|onboarding" docs/architecture/FRONTEND.md docs/product/PRODUCT_SENSE.md` — 若 FRONTEND.md 記載了 student tour（PR #236 可能有寫），補上 teacher/TA tour 一句與 `lib/onboarding/` 模組結構；沒寫就不加。

**Step 2:** 設計文件 `docs/plans/active/2026-07-11-teacher-onboarding-tour.md` 與本計畫一起隨 PR 提交（完成 merge 後才移 completed/，本次不 merge、不移動）。

**Step 3: Commit**（若有文件改動）

```bash
git add docs/
git commit -m "docs: teacher onboarding tour design + implementation plan"
```

---

## Task 9: 全面驗證

1. `pnpm --filter @nojv/web paraglide:compile`（保險再跑）
2. `pnpm lint` → 0 errors
3. `pnpm --filter @nojv/web check` → 0 errors
4. `pnpm test:unit` → 全綠（216+ 檔）
5. **實機走查（必做——`step()` 靜默跳過缺錨，selector 打錯不會報錯）**：
   - 依 memory `reference_worktree_dev_server`：worktree 內 `pnpm --filter @nojv/web dev -- --port 5174 --strictPort`（packages 已 build、.env 已複製）
   - 用 `tests/fixtures/auth-states/teacher.json` 的 cookie 餵瀏覽器（**注意 fixture 現在帶 `nojv:tour:off`，實測前先在 console `localStorage.removeItem("nojv:tour:off")` 並清 `nojv:tour:seen:*`**）
   - 教師帳號、視窗 ≥1024px，依序走 `/dashboard → /courses → /courses/[id]/members → /problems → /problems/[id]/edit → /courses/[id]/assignments/new → /assignments/[id] → /courses/[id]/grades`，確認 8 個 intro 各自出現、步驟齊全、文案正確、HelpTooltip hover 有效
   - settings 頁按「重看導覽」→ teacher-nav intro 重播
   - 學生帳號走 `/courses/[id]/members`（非 TA）→ 無任何 teacher intro
6. e2e 針對性回歸：`pnpm test:e2e -- dashboard course-manage problem-lifecycle assignments`（或依 runner 語法跑這幾檔）→ 綠

## Task 10: 收尾

1. `pnpm format:write` → commit 格式修正（若有）
2. Push branch `feat/teacher-onboarding-tour`
3. **開 PR（title: `feat(web): teacher onboarding tour + bulk-add help tooltip`），內文附設計文件連結與驗證截圖。不要 merge——使用者指示留給人工審。**
