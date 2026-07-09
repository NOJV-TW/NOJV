import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { m } from "$lib/paraglide/messages.js";

export const STUDENT_TOUR_SEEN_KEY = "nojv:tour:student:v1";

function steps(): DriveStep[] {
  return [
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
      element: '[data-tour="nav-courses"]',
      popover: {
        title: m.tour_student_coursesTitle(),
        description: m.tour_student_coursesBody(),
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
      element: '[data-tour="nav-problems"]',
      popover: {
        title: m.tour_student_doneTitle(),
        description: m.tour_student_doneBody(),
        side: "bottom",
        align: "center",
      },
    },
  ];
}

export function startStudentTour(): void {
  const tour = driver({
    showProgress: true,
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: "nojv-tour",
    progressText: "{{current}} / {{total}}",
    nextBtnText: m.tour_next(),
    prevBtnText: m.tour_prev(),
    doneBtnText: m.tour_done(),
    steps: steps(),
    onDestroyed: () => {
      try {
        localStorage.setItem(STUDENT_TOUR_SEEN_KEY, "1");
      } catch {
        // private mode / storage blocked — tour just re-runs next visit
      }
    },
  });
  tour.drive();
}

// Auto-start on first visit. Anchors live in the desktop nav (hidden below
// lg), so this is a no-op on small screens. Returns a cleanup for the timer.
export function maybeAutostartStudentTour(): (() => void) | void {
  if (typeof window === "undefined") return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  let seen = false;
  try {
    seen = localStorage.getItem(STUDENT_TOUR_SEEN_KEY) === "1";
  } catch {
    seen = false;
  }
  if (seen) return;
  const id = window.setTimeout(startStudentTour, 400);
  return () => window.clearTimeout(id);
}
