import { driver, type Config, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { m } from "$lib/paraglide/messages.js";

// Each page owns its own intro, keyed independently so it fires the first time
// that page is visited — no forced cross-page walk.
const SEEN_PREFIX = "nojv:tour:seen:";
const PROBLEM_DETAIL = /^\/problems\/[^/]+$/;

type Side = "top" | "bottom" | "left" | "right";

function seen(key: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + key) === "1";
  } catch {
    return false;
  }
}
function markSeen(key: string) {
  try {
    localStorage.setItem(SEEN_PREFIX + key, "1");
  } catch {
    // storage blocked — intro just re-runs next visit
  }
}
function clearAllSeen() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(SEEN_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

const BASE: Config = {
  overlayOpacity: 0.6,
  stageRadius: 12,
  popoverClass: "nojv-tour",
  overlayClickBehavior: "nextStep", // click anywhere (incl. the dimmed area) to advance
};

// One live intro at a time. driver.js appends its overlay to <body>, so it
// survives SvelteKit navigations; we tear it down ourselves. A "silent"
// teardown (we left the page) must not chain to the next intro.
let active: Driver | null = null;
let silent = false;

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

// Data-gated by element presence: on an empty dashboard the charts aren't
// rendered, so this yields no steps and stays unseen until there's data.
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
    onDestroyed: () => {
      if (active === d) active = null;
      markSeen(key);
      // Chain to the next unseen intro on the same page (e.g. nav → dashboard
      // stats) — unless we were torn down because the user left the page.
      if (!silent) {
        window.setTimeout(() => maybeRunIntro(window.location.pathname), 200);
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
    if (steps.length === 0) continue; // elements absent (e.g. dashboard w/o data)
    runIntro(intro.key, steps, intro.pad);
    return;
  }
}

function teardownForNav() {
  if (!active) return;
  silent = true;
  active.destroy();
  silent = false;
}

// Called by the (app) layout after every navigation.
export function onStudentNavigate(pathname: string): void {
  if (typeof window === "undefined") return;
  teardownForNav();
  window.setTimeout(() => maybeRunIntro(pathname), 350);
}

// "Replay tour" from the user menu: reset every page's flag and start over from
// the nav intro; subsequent page intros re-fire as the student browses.
export function replayStudentTour(): void {
  if (typeof window === "undefined") return;
  clearAllSeen();
  teardownForNav();
  const nav = INTROS.find((intro) => intro.key === "nav");
  if (nav) runIntro(nav.key, nav.build(), nav.pad);
}
