import type {
  JudgeConfig,
  JudgeType,
  Language,
  ProblemImageSource,
  ProblemOverview,
  ProblemStatus,
  ProblemType,
  ProblemVisibility,
  SubmissionResult
} from "@nojv/core";

// `id` is absent for local-only entries added before server persistence; when present, source is lazily fetched.
export interface ProblemSubmissionEntry {
  id?: string;
  language: string;
  result: SubmissionResult;
  sourceCode?: string;
  submittedAt: string;
}

export interface ProblemEditorialEntry {
  id: string;
  content: string;
  language: string;
  createdAt: string;
  user: { username: string | null; name: string };
}

export interface ProblemTestcaseSetSummary {
  id: string;
  name: string;
  description: string;
  weight: number;
  ordinal: number;
  caseCount: number;
}

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

export const verdictColor: Record<string, string> = {
  accepted: "text-emerald-600 dark:text-emerald-400",
  compile_error: "text-amber-600 dark:text-amber-400",
  compiling: "text-muted-foreground",
  memory_limit_exceeded: "text-red-600 dark:text-red-400",
  queued: "text-muted-foreground",
  running: "text-muted-foreground",
  runtime_error: "text-amber-600 dark:text-amber-400",
  time_limit_exceeded: "text-red-600 dark:text-red-400",
  wrong_answer: "text-red-600 dark:text-red-400"
};

export interface ProblemDetail extends ProblemOverview {
  authorUsername: string;
  inputFormat: string;
  judgeConfig: JudgeConfig;
  judgeType: JudgeType;
  memoryLimitMb: number;
  outputFormat: string;
  type: ProblemType;
  samples: {
    input: string;
    output: string;
  }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  status: ProblemStatus;
  tags: string[];
  timeLimitMs: number;
  visibility: ProblemVisibility;
  advancedImageRef: string | null;
  advancedImageSource: ProblemImageSource | null;
  // Hidden files have `content === ""`; the domain layer blanks them before they leave the server.
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    description: string;
  }[];
}

export function assessmentPath(courseId: string, assessmentSlug: string): string {
  // TODO(phase-2): update to the new /courses/[courseId] subtree once
  // it lands in Task 2.1. During Phase 1 this is a dead link.
  return `/courses/${courseId}/assignments/${assessmentSlug}`;
}

export type AssessmentWindowState = "upcoming" | "open" | "grace" | "closed";

interface AssessmentWindowStateInput {
  closesAt: string;
  /** Soft deadline — null = no late penalty configured (no `grace` state). */
  dueAt: string | null;
  now?: string;
  opensAt: string;
}

export interface AssessmentPresentation {
  heroLabel: string;
  supportLabel: string;
}

export function deriveAssessmentWindowState({
  closesAt,
  dueAt,
  now,
  opensAt
}: AssessmentWindowStateInput): AssessmentWindowState {
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

const windowStateColors: Record<AssessmentWindowState, string> = {
  closed: "text-[color:var(--color-muted-foreground)]",
  grace: "text-amber-600 dark:text-amber-400",
  open: "text-emerald-600 dark:text-emerald-400",
  upcoming: "text-blue-600 dark:text-blue-400"
};

export function windowStateColorClass(state: AssessmentWindowState) {
  return windowStateColors[state];
}

export const assessmentPresentation: AssessmentPresentation = {
  heroLabel: "Deadline-driven assignment workspace",
  supportLabel: "Coursework framing with open, due, and close windows"
};
