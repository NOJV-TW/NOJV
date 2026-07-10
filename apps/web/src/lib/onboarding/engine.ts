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
