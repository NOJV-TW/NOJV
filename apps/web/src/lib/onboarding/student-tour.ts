import type { DriveStep } from "driver.js";
import { m } from "$lib/paraglide/messages.js";
import { replayTour, step, type Intro } from "./engine";

const PROBLEM_DETAIL = /^\/problems\/[^/]+$/;

function navSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="nav-primary"]',
      m.tour_student_welcomeTitle(),
      m.tour_student_welcomeBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-dashboard"]',
      m.tour_student_overviewTitle(),
      m.tour_student_overviewBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-problems"]',
      m.tour_student_problemsTitle(),
      m.tour_student_problemsBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-submissions"]',
      m.tour_student_submissionsTitle(),
      m.tour_student_submissionsBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-courses"]',
      m.tour_student_coursesTitle(),
      m.tour_student_coursesBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="nav-assignments"]',
      m.tour_student_courseworkTitle(),
      m.tour_student_courseworkBody(),
      "bottom",
    ),
  ];
}

function dashboardSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="dashboard-stats"]',
      m.tour_student_dashStatsTitle(),
      m.tour_student_dashStatsBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="dashboard-charts"]',
      m.tour_student_dashChartsTitle(),
      m.tour_student_dashChartsBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="dashboard-heatmap"]',
      m.tour_student_dashHeatmapTitle(),
      m.tour_student_dashHeatmapBody(),
      "top",
    ),
    ...step(
      '[data-tour="dashboard-distributions"]',
      m.tour_student_dashDistTitle(),
      m.tour_student_dashDistBody(),
      "top",
    ),
    ...step(
      '[data-tour="dashboard-recent"]',
      m.tour_student_dashRecentTitle(),
      m.tour_student_dashRecentBody(),
      "top",
    ),
  ];
}

function problemsSteps(): DriveStep[] {
  return step(
    '[data-tour="first-problem"]',
    m.tour_student_pickTitle(),
    m.tour_student_pickBody(),
    "bottom",
  );
}

function problemSteps(): DriveStep[] {
  return [
    ...step(
      '[data-tour="problem-statement"]',
      m.tour_student_readTitle(),
      m.tour_student_readBody(),
      "right",
    ),
    ...step(
      '[data-tour="problem-bookmark"]',
      m.tour_student_bookmarkTitle(),
      m.tour_student_bookmarkBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="problem-language"]',
      m.tour_student_languageTitle(),
      m.tour_student_languageBody(),
      "bottom",
    ),
    ...step(
      '[data-tour="problem-samples"]',
      m.tour_student_samplesTitle(),
      m.tour_student_samplesBody(),
      "top",
    ),
    ...step(
      '[data-tour="problem-actions"]',
      m.tour_student_actionsTitle(),
      m.tour_student_actionsBody(),
      "top",
    ),
  ];
}

export const studentIntros: Intro[] = [
  { key: "nav", pad: 2, match: (p) => p === "/dashboard", build: navSteps },
  { key: "dashboard", pad: 6, match: (p) => p === "/dashboard", build: dashboardSteps },
  { key: "problems", pad: 6, match: (p) => p === "/problems", build: problemsSteps },
  { key: "problem", pad: 4, match: (p) => PROBLEM_DETAIL.test(p), build: problemSteps },
];

export function replayStudentTour(userId: string): void {
  replayTour(userId, studentIntros);
}
