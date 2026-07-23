import { driver, type Config, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { m } from "$lib/paraglide/messages.js";

type Side = "top" | "bottom" | "left" | "right";

export interface Intro {
  key: string;
  pad: number;
  match: (pathname: string) => boolean;
  build: () => DriveStep[];
}

let registry: Intro[] = [];
let active: Driver | null = null;
let manualReplay = false;
const manualSeen = new Set<string>();
let silent = false;
let pendingTimer: number | undefined;

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

function runIntro(key: string, steps: DriveStep[], pad: number, manual: boolean) {
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
      if (manual) manualSeen.add(key);
      if (manual && !silent && !closedByUser && reachedLastStep) {
        scheduleManualIntro(window.location.pathname, 200);
      }
    },
  });
  active = d;
  d.drive();
}

function maybeRunManualIntro(pathname: string) {
  if (typeof window === "undefined") return;
  if (!manualReplay) return;
  if (active) return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  for (const intro of registry) {
    if (!intro.match(pathname) || manualSeen.has(intro.key)) continue;
    const steps = intro.build();
    if (steps.length === 0) continue;
    runIntro(intro.key, steps, intro.pad, true);
    return;
  }
}

function scheduleManualIntro(pathname: string, delay: number) {
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => maybeRunManualIntro(pathname), delay);
}

function teardownForNav() {
  window.clearTimeout(pendingTimer);
  if (!active) return;
  silent = true;
  active.destroy();
  silent = false;
}

export function onTourNavigate(pathname: string, intros: Intro[]): void {
  if (typeof window === "undefined") return;
  teardownForNav();
  registry = intros;
  if (manualReplay) scheduleManualIntro(pathname, 350);
}

export function replayTour(intros: Intro[]): void {
  if (typeof window === "undefined") return;
  teardownForNav();
  manualReplay = true;
  registry = intros;
  manualSeen.clear();
  for (const intro of intros) {
    const steps = intro.build();
    if (steps.length > 0) {
      runIntro(intro.key, steps, intro.pad, true);
      return;
    }
  }
}

function automaticTourBlocked(intro: Intro): boolean {
  return active !== null || manualReplay || !intro.match(window.location.pathname);
}

export async function startAutomaticTour(
  intro: Intro,
  claim: () => Promise<boolean>,
): Promise<void> {
  if (typeof window === "undefined" || automaticTourBlocked(intro)) return;
  if (!window.matchMedia("(min-width: 1024px)").matches) return;
  const steps = intro.build();
  if (steps.length === 0 || !(await claim())) return;
  if (automaticTourBlocked(intro)) return;
  const currentSteps = intro.build();
  if (currentSteps.length > 0) runIntro(intro.key, currentSteps, intro.pad, false);
}
