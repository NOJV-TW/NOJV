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

/**
 * Shared shape used by both the standard and advanced problem workspaces
 * for rendering submission history in the left-pane submissions tab.
 *
 * `id` is absent for submissions that have not yet been persisted (e.g. a
 * fresh local entry added right after `handleSubmissionComplete`). When
 * present, the left pane lazily fetches source code from `/api/submissions/:id/source`.
 */
export interface ProblemSubmissionEntry {
  id?: string;
  language: string;
  result: SubmissionResult;
  sourceCode?: string;
  submittedAt: string;
}

/**
 * Authored editorial displayed inside the left-pane editorials tab. This
 * mirrors the payload returned by `GET /api/problems/:id/editorials`.
 */
export interface ProblemEditorialEntry {
  id: string;
  content: string;
  language: string;
  createdAt: string;
  user: { username: string | null; name: string };
}

/**
 * Subtask/testcase-set summary rendered in the description tab under the
 * problem statement. Both workspaces receive the same shape from the load
 * function.
 */
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
  /**
   * Single source of truth for "what shape is this problem". Mirror of
   * `Problem.type` in the schema.
   */
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
    editableRegions: [number, number][] | null;
    description: string;
  }[];
}

export function assessmentPath(courseSlug: string, assessmentSlug: string): string {
  return `/courses/${courseSlug}/assignments/${assessmentSlug}`;
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
