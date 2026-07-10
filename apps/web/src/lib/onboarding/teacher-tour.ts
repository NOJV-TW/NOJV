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
    ...step(
      '[data-tour="nav-primary"]',
      m.tour_teacher_welcomeTitle(),
      m.tour_teacher_welcomeBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-courses"]',
      m.tour_teacher_coursesNavTitle(),
      m.tour_teacher_coursesNavBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-problems"]',
      m.tour_teacher_problemsNavTitle(),
      m.tour_teacher_problemsNavBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-submissions"]',
      m.tour_teacher_submissionsNavTitle(),
      m.tour_teacher_submissionsNavBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="welcome-guide"]',
      m.tour_teacher_welcomeGuideTitle(),
      m.tour_teacher_welcomeGuideBody(),
      "bottom",
    ),
  ];
}

function coursesSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="courses-managing"]',
      m.tour_teacher_managingTitle(),
      m.tour_teacher_managingBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="courses-create"]',
      m.tour_teacher_createCourseTitle(),
      m.tour_teacher_createCourseBody(),
      "bottom",
    ),
  ];
}

function membersSteps(): DriveStep[] {
  const bulkAdd = step(
    '[data-tour="members-bulk-add"]',
    m.tour_teacher_bulkAddTitle(),
    m.tour_teacher_bulkAddBody(),
    "right",
  );
  if (bulkAdd.length === 0) return [];
  return [
    ...step(
      '[data-tour="course-tabs"]',
      m.tour_teacher_courseTabsTitle(),
      m.tour_teacher_courseTabsBody(),
      "bottom",
    ),
    ...bulkAdd,
    ...step(
      '[data-tour="members-role"]',
      m.tour_teacher_memberRoleTitle(),
      m.tour_teacher_memberRoleBody(),
      "left",
    ),
  ];
}

function problemsSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="problems-mine"]',
      m.tour_teacher_myProblemsTitle(),
      m.tour_teacher_myProblemsBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="problems-create"]',
      m.tour_teacher_createProblemTitle(),
      m.tour_teacher_createProblemBody(),
      "bottom",
    ),
  ];
}

function problemEditSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="edit-rail"]',
      m.tour_teacher_editRailTitle(),
      m.tour_teacher_editRailBody(),
      "right",
    ),
    ...step(
      '[data-tour="problem-publish"]',
      m.tour_teacher_publishTitle(),
      m.tour_teacher_publishBody(),
      "right",
    ),
  ];
}

function assignmentNewSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="assignment-picker"]',
      m.tour_teacher_pickProblemsTitle(),
      m.tour_teacher_pickProblemsBody(),
      "right",
    ),
    ...step(
      '[data-tour="assignment-schedule"]',
      m.tour_teacher_scheduleTitle(),
      m.tour_teacher_scheduleBody(),
      "top",
    ),
    ...step(
      '[data-tour="assignment-publish"]',
      m.tour_teacher_assignPublishTitle(),
      m.tour_teacher_assignPublishBody(),
      "top",
    ),
  ];
}

function monitorSteps(): DriveStep[] {
  return step(
    "#assignment-manage-tab-problems",
    m.tour_teacher_manageTabsTitle(),
    m.tour_teacher_manageTabsBody(),
    "bottom",
  );
}

function gradebookSteps(): DriveStep[] {
  const exportBtn = step(
    '[data-tour="gradebook-export"]',
    m.tour_teacher_gradebookExportTitle(),
    m.tour_teacher_gradebookExportBody(),
    "left",
  );
  if (exportBtn.length === 0) return [];
  return [
    ...step(
      '[data-slot="course-gradebook"]',
      m.tour_teacher_gradebookTitle(),
      m.tour_teacher_gradebookBody(),
      "top",
    ),
    ...exportBtn,
  ];
}

const INTROS: Intro[] = [
  { key: "teacher-nav", pad: 2, match: (p) => p === "/dashboard", build: navSteps },
  { key: "teacher-courses", pad: 4, match: (p) => p === "/courses", build: coursesSteps },
  { key: "teacher-members", pad: 6, match: (p) => MEMBERS.test(p), build: membersSteps },
  { key: "teacher-problems", pad: 4, match: (p) => p === "/problems", build: problemsSteps },
  {
    key: "teacher-problem-edit",
    pad: 4,
    match: (p) => PROBLEM_EDIT.test(p),
    build: problemEditSteps,
  },
  {
    key: "teacher-assignment-new",
    pad: 6,
    match: (p) => ASSIGNMENT_NEW.test(p),
    build: assignmentNewSteps,
  },
  {
    key: "teacher-monitor",
    pad: 6,
    match: (p) => ASSIGNMENT_DETAIL.test(p),
    build: monitorSteps,
  },
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
