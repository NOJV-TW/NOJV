import { driver, type Config, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { goto } from "$app/navigation";
import { m } from "$lib/paraglide/messages.js";

// Set once the tour finishes or is dismissed — suppresses the first-visit autostart.
const SEEN_KEY = "nojv:tour:student:v1";
// Tracks an in-progress cross-page tour so the next page can resume it.
const STAGE_KEY = "nojv:tour:student:stage";
type Stage = "pick" | "read";

const PROBLEM_DETAIL = /^\/problems\/[^/]+$/;

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // storage blocked — tour just re-runs next visit
  }
}
function setStage(stage: Stage) {
  try {
    localStorage.setItem(STAGE_KEY, stage);
  } catch {
    // ignore
  }
}
function getStage(): string | null {
  try {
    return localStorage.getItem(STAGE_KEY);
  } catch {
    return null;
  }
}
function clearStage() {
  try {
    localStorage.removeItem(STAGE_KEY);
  } catch {
    // ignore
  }
}

// The tour spans pages, and driver.js appends its overlay to <body>, so it
// survives SvelteKit navigations. We keep one instance and tear it down
// ourselves. A "silent" teardown (superseded by navigation) must NOT end the
// tour; a user-driven close (X / Esc) must.
let active: Driver | null = null;
let silent = false;

function teardown(opts: { silent: boolean }) {
  if (!active) return;
  const d = active;
  active = null;
  silent = opts.silent;
  d.destroy();
  silent = false;
}

const BASE: Config = {
  overlayOpacity: 0.6,
  stagePadding: 6,
  stageRadius: 12,
  popoverClass: "nojv-tour",
};

function endTour() {
  markSeen();
  clearStage();
}

// Segment 1 (dashboard): welcome + the three primary nav destinations, then a
// "start solving" CTA that hands off to the problem list.
export function startStudentTour(): void {
  const steps: DriveStep[] = [
    {
      element: '[data-tour="nav-primary"]',
      popover: {
        title: m.tour_student_welcomeTitle(),
        description: m.tour_student_welcomeBody(),
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="nav-problems"]',
      popover: {
        title: m.tour_student_problemsTitle(),
        description: m.tour_student_problemsBody(),
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="nav-submissions"]',
      popover: {
        title: m.tour_student_submissionsTitle(),
        description: m.tour_student_submissionsBody(),
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="nav-courses"]',
      popover: {
        title: m.tour_student_coursesTitle(),
        description: m.tour_student_coursesBody(),
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="nav-primary"]',
      popover: {
        title: m.tour_student_doneTitle(),
        description: m.tour_student_doneBody(),
        side: "bottom",
        align: "start",
      },
    },
  ];

  const d = driver({
    ...BASE,
    stagePadding: 2, // nav items sit ~4px apart — a wide stage bleeds into neighbors
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: m.tour_next(),
    prevBtnText: m.tour_prev(),
    doneBtnText: m.tour_startSolving(),
    steps,
    onNextClick: () => {
      if (d.isLastStep()) {
        setStage("pick");
        teardown({ silent: true });
        void goto("/problems");
      } else {
        d.moveNext();
      }
    },
    onDestroyed: () => {
      if (active === d) active = null;
      if (!silent) endTour();
    },
  });
  active = d;
  d.drive();
}

// Segment 2 (/problems): point at the first problem. The user advances by
// opening it — via the button OR by clicking the card directly; either way the
// navigation is what drives the next stage (see resumeStudentTour).
function drivePickSegment(): void {
  const card = document.querySelector('[data-tour="first-problem"]');
  if (!card) {
    endTour(); // no problems to show — end rather than dead-ending
    return;
  }
  const href = card
    .querySelector<HTMLAnchorElement>('a[href^="/problems/"]')
    ?.getAttribute("href");

  const d = driver({
    ...BASE,
    showProgress: false,
    showButtons: ["next", "close"],
    doneBtnText: m.tour_openProblem(),
    steps: [
      {
        element: '[data-tour="first-problem"]',
        popover: {
          title: m.tour_student_pickTitle(),
          description: m.tour_student_pickBody(),
          side: "bottom",
          align: "start",
        },
      },
    ],
    onNextClick: () => {
      teardown({ silent: true });
      if (href) void goto(href);
    },
    onDestroyed: () => {
      if (active === d) active = null;
      if (!silent) endTour();
    },
  });
  active = d;
  d.drive();
}

// Segment 3 (/problems/[id]): walk the problem-solving surface, then finish.
// Only steps whose element is present are included, so a missing control never
// leaves an unmasked (element-less) step.
function driveReadSegment(): void {
  const mk = (
    sel: string,
    title: string,
    description: string,
    side: "top" | "bottom" | "left" | "right",
  ): DriveStep[] =>
    document.querySelector(sel)
      ? [{ element: sel, popover: { title, description, side, align: "start" } }]
      : [];

  const steps: DriveStep[] = [
    ...mk(
      '[data-tour="problem-statement"]',
      m.tour_student_readTitle(),
      m.tour_student_readBody(),
      "right",
    ),
    ...mk(
      '[data-tour="problem-bookmark"]',
      m.tour_student_bookmarkTitle(),
      m.tour_student_bookmarkBody(),
      "bottom",
    ),
    ...mk(
      '[data-tour="problem-language"]',
      m.tour_student_languageTitle(),
      m.tour_student_languageBody(),
      "bottom",
    ),
    ...mk(
      '[data-tour="problem-samples"]',
      m.tour_student_samplesTitle(),
      m.tour_student_samplesBody(),
      "top",
    ),
    ...mk(
      '[data-tour="problem-actions"]',
      m.tour_student_actionsTitle(),
      m.tour_student_actionsBody(),
      "top",
    ),
  ];
  if (steps.length === 0) {
    endTour();
    return;
  }

  const d = driver({
    ...BASE,
    stagePadding: 4,
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: m.tour_next(),
    prevBtnText: m.tour_prev(),
    doneBtnText: m.tour_done(),
    steps,
    onDestroyed: () => {
      if (active === d) active = null;
      if (!silent) endTour();
    },
  });
  active = d;
  d.drive();
}

// Called after every navigation. Drives the cross-page progression: opening a
// problem while picking (by button or direct click) advances to the statement.
export function resumeStudentTour(pathname: string): void {
  if (typeof window === "undefined") return;
  const stage = getStage();
  const onProblemDetail = PROBLEM_DETAIL.test(pathname);

  // Nav intro is running (no stage yet) and the user reached the problem list —
  // via the CTA button OR by clicking the highlighted Problems link. Advance.
  if (active && !stage && pathname === "/problems") {
    teardown({ silent: true });
    setStage("pick");
    window.setTimeout(drivePickSegment, 300);
    return;
  }

  if (stage === "pick" && onProblemDetail) {
    teardown({ silent: true });
    setStage("read");
    window.setTimeout(driveReadSegment, 300);
    return;
  }
  if (stage === "pick" && pathname === "/problems") {
    teardown({ silent: true });
    window.setTimeout(drivePickSegment, 300);
    return;
  }
  if (stage === "read" && onProblemDetail) {
    teardown({ silent: true });
    window.setTimeout(driveReadSegment, 300);
    return;
  }
  // Navigated off the tour's path — end it (also removes any lingering overlay).
  if (active) teardown({ silent: false });
}

// First-visit autostart. Anchors live in the desktop nav (hidden below lg), so
// this is a no-op on small screens. Returns a cleanup for the timer.
export function maybeAutostartStudentTour(): (() => void) | void {
  if (typeof window === "undefined") return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    seen = false;
  }
  if (seen) return;
  const id = window.setTimeout(startStudentTour, 400);
  return () => window.clearTimeout(id);
}
