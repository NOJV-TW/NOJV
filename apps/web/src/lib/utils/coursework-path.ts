export function assignmentPath(assignmentId: string): string {
  return `/assignments/${assignmentId}`;
}

export type AssignmentWindowState = "upcoming" | "open" | "grace" | "closed";

interface AssignmentWindowStateInput {
  closesAt: string;
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
  grace: "text-warning",
  open: "text-success",
  upcoming: "text-info",
};

export function windowStateColorClass(state: AssignmentWindowState): string {
  return windowStateColors[state];
}
