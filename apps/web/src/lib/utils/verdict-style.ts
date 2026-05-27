// Visual treatment helpers for problem / submission verdicts.
// Pure presentation; no runtime imports of route data.

export function formatVerdictLabel(verdict: string): string {
  return verdict.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// Topic/skill tag pill — intentionally uniform, colour-coding lives on the
// dedicated `Problem.difficulty` column (see `difficultyClass`).
export function tagClass(): string {
  return "bg-muted text-muted-foreground border-border";
}

export function difficultyClass(difficulty: string): string {
  if (difficulty === "easy") return "bg-success/15 text-success border-success/25";
  if (difficulty === "medium") return "bg-warning/15 text-warning border-warning/25";
  if (difficulty === "hard") return "bg-destructive/15 text-destructive border-destructive/25";
  return "bg-muted text-muted-foreground border-border";
}

// Single source of truth for verdict colour. Canonical semantics: resource
// limits (TLE/MLE) = warning, errors (WA/RE/CE) = destructive, AC = success,
// pre-terminal (queued/running/compiling) = pending. Accepts both the full
// operation-status enum and the sandbox short codes (AC/WA/TLE/MLE/RE/CE) used
// inside subtask case results.

// Subset of the Badge component's `variant` union — every member below is a
// valid `BadgeVariant`, so the return value flows straight into <Badge variant>.
export type VerdictBadgeVariant =
  | "success"
  | "warning"
  | "destructive"
  | "verdict-pending"
  | "muted";

const SHORT_CODE_TO_VERDICT: Record<string, string> = {
  AC: "accepted",
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  CE: "compile_error",
};

function normalizeVerdict(verdict: string): string {
  return SHORT_CODE_TO_VERDICT[verdict] ?? verdict;
}

const VERDICT_VARIANT: Record<string, VerdictBadgeVariant> = {
  accepted: "success",
  wrong_answer: "destructive",
  runtime_error: "destructive",
  compile_error: "destructive",
  time_limit_exceeded: "warning",
  memory_limit_exceeded: "warning",
  queued: "verdict-pending",
  running: "verdict-pending",
  compiling: "verdict-pending",
};

const VERDICT_TONE: Record<string, string> = {
  accepted: "text-success",
  wrong_answer: "text-destructive",
  runtime_error: "text-destructive",
  compile_error: "text-destructive",
  time_limit_exceeded: "text-warning",
  memory_limit_exceeded: "text-warning",
  queued: "text-muted-foreground",
  running: "text-muted-foreground",
  compiling: "text-muted-foreground",
};

/** Badge variant for a verdict — use via the `VerdictBadge` component or for
 *  subtask case pills that keep their short-code label. */
export function verdictBadgeVariant(verdict: string): VerdictBadgeVariant {
  return VERDICT_VARIANT[normalizeVerdict(verdict)] ?? "muted";
}

/** Text-colour class for large/hero verdict text (submission detail header,
 *  run-result heading) where a pill would be too heavy. */
export function verdictTone(verdict: string): string {
  return VERDICT_TONE[normalizeVerdict(verdict)] ?? "text-foreground";
}
