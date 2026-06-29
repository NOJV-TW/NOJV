import { m } from "$lib/paraglide/messages.js";

export function formatVerdictLabel(verdict: string): string {
  const label = VERDICT_LABEL[normalizeVerdict(verdict)];
  if (label) return label();
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
  | "verdict-ac"
  | "verdict-wa"
  | "verdict-re"
  | "verdict-tle"
  | "verdict-mle"
  | "verdict-ce"
  | "verdict-se"
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

const VERDICT_LABEL: Record<string, () => string> = {
  accepted: m.verdict_accepted,
  wrong_answer: m.verdict_wrong_answer,
  runtime_error: m.verdict_runtime_error,
  compile_error: m.verdict_compile_error,
  time_limit_exceeded: m.verdict_time_limit_exceeded,
  memory_limit_exceeded: m.verdict_memory_limit_exceeded,
  system_error: m.verdict_system_error,
  pending_upload: m.verdict_pending_upload,
  queued: m.verdict_queued,
  running: m.verdict_running,
  compiling: m.verdict_compiling,
};

const VERDICT_VARIANT: Record<string, VerdictBadgeVariant> = {
  accepted: "verdict-ac",
  wrong_answer: "verdict-wa",
  runtime_error: "verdict-re",
  compile_error: "verdict-ce",
  time_limit_exceeded: "verdict-tle",
  memory_limit_exceeded: "verdict-mle",
  system_error: "verdict-se",
  pending_upload: "verdict-pending",
  queued: "verdict-pending",
  running: "verdict-pending",
  compiling: "verdict-pending",
};

const VERDICT_TONE: Record<string, string> = {
  accepted: "text-success",
  wrong_answer: "text-destructive",
  runtime_error: "text-verdict-orange",
  compile_error: "text-info",
  time_limit_exceeded: "text-warning",
  memory_limit_exceeded: "text-verdict-purple",
  system_error: "text-muted-foreground",
  pending_upload: "text-verdict-cyan",
  queued: "text-verdict-cyan",
  running: "text-verdict-cyan",
  compiling: "text-verdict-cyan",
};

export function verdictBadgeVariant(verdict: string): VerdictBadgeVariant {
  return VERDICT_VARIANT[normalizeVerdict(verdict)] ?? "muted";
}

export function verdictTone(verdict: string): string {
  return VERDICT_TONE[normalizeVerdict(verdict)] ?? "text-foreground";
}
