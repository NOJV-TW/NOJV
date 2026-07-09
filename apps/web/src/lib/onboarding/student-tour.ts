import { driver, type Config, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { m } from "$lib/paraglide/messages.js";

const SEEN_PREFIX = "nojv:tour:seen:";
const PROBLEM_DETAIL = /^\/problems\/[^/]+$/;

type Side = "top" | "bottom" | "left" | "right";

let uid = "";

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
function clearAllSeen() {
  try {
    const prefix = `${SEEN_PREFIX}${uid}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) localStorage.removeItem(k);
    }
  } catch {
    return;
  }
}

const BASE: Config = {
  overlayOpacity: 0.6,
  stageRadius: 12,
  popoverClass: "nojv-tour",
  overlayClickBehavior: "nextStep",
};

let active: Driver | null = null;
let silent = false;
let pendingTimer: number | undefined;

function step(sel: string, title: string, description: string, side: Side): DriveStep[] {
  return typeof document !== "undefined" && document.querySelector(sel)
    ? [{ element: sel, popover: { title, description, side, align: "start" } }]
    : [];
}

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

interface Intro {
  key: string;
  pad: number;
  match: (pathname: string) => boolean;
  build: () => DriveStep[];
}

const INTROS: Intro[] = [
  { key: "nav", pad: 2, match: (p) => p === "/dashboard", build: navSteps },
  { key: "dashboard", pad: 6, match: (p) => p === "/dashboard", build: dashboardSteps },
  { key: "problems", pad: 6, match: (p) => p === "/problems", build: problemsSteps },
  { key: "problem", pad: 4, match: (p) => PROBLEM_DETAIL.test(p), build: problemSteps },
];

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
  if (active) return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  for (const intro of INTROS) {
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

export function onStudentNavigate(pathname: string, userId: string): void {
  if (typeof window === "undefined") return;
  uid = userId;
  teardownForNav();
  scheduleIntro(pathname, 350);
}

export function replayStudentTour(userId: string): void {
  if (typeof window === "undefined") return;
  uid = userId;
  clearAllSeen();
  teardownForNav();
  const nav = INTROS.find((intro) => intro.key === "nav");
  if (nav) runIntro(nav.key, nav.build(), nav.pad);
}
