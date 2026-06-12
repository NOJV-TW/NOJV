export function formatVerdictLabel(verdict: string): string {
  return verdict.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function tagClass(): string {
  return "bg-muted text-muted-foreground border-border";
}

export function difficultyClass(difficulty: string): string {
  if (difficulty === "easy") return "bg-success/15 text-success border-success/25";
  if (difficulty === "medium") return "bg-warning/15 text-warning border-warning/25";
  if (difficulty === "hard") return "bg-destructive/15 text-destructive border-destructive/25";
  return "bg-muted text-muted-foreground border-border";
}

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
  SE: "system_error",
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
  system_error: "warning",
  pending_upload: "verdict-pending",
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
  system_error: "text-warning",
  pending_upload: "text-muted-foreground",
  queued: "text-muted-foreground",
  running: "text-muted-foreground",
  compiling: "text-muted-foreground",
};

export function verdictBadgeVariant(verdict: string): VerdictBadgeVariant {
  return VERDICT_VARIANT[normalizeVerdict(verdict)] ?? "muted";
}

export function verdictTone(verdict: string): string {
  return VERDICT_TONE[normalizeVerdict(verdict)] ?? "text-foreground";
}
