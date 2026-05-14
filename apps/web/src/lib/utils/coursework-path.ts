// Path builders for the coursework family — only `assignmentPath` has
// real consumers today. `examPath` / `contestPath` were dropped during
// the 2026-05-15 audit (path templates were always inlined at the call
// sites). Keeping `assignmentPath` here in case more route refactors
// need a single source of truth.

export function assignmentPath(assignmentId: string): string {
  return `/assignments/${assignmentId}`;
}

export type AssignmentWindowState = "upcoming" | "open" | "grace" | "closed";

interface AssignmentWindowStateInput {
  closesAt: string;
  /** Soft deadline — null = no late penalty configured (no `grace` state). */
  dueAt: string | null;
  now?: string;
  opensAt: string;
}

export function deriveAssignmentWindowState({
  closesAt,
  dueAt,
  now,
  opensAt,
}: AssignmentWindowStateInput): AssignmentWindowState {
  const currentTime = now ? new Date(now) : new Date();
  const opensDate = new Date(opensAt);
  const closesDate = new Date(closesAt);
  // When there's no soft due date, we treat the whole open window as
  // "open" — students never hit the grace state.
  const dueDate = dueAt ? new Date(dueAt) : closesDate;

  if (currentTime < opensDate) {
    return "upcoming";
  }

  if (currentTime <= dueDate) {
    return "open";
  }

  if (currentTime <= closesDate) {
    return "grace";
  }

  return "closed";
}

const windowStateColors: Record<AssignmentWindowState, string> = {
  closed: "text-[color:var(--color-muted-foreground)]",
  grace: "text-amber-600 dark:text-amber-400",
  open: "text-emerald-600 dark:text-emerald-400",
  upcoming: "text-blue-600 dark:text-blue-400",
};

export function windowStateColorClass(state: AssignmentWindowState): string {
  return windowStateColors[state];
}
