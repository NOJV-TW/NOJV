import type {
  JudgeConfig,
  JudgeType,
  Language,
  ProblemImageSource,
  ProblemOverview,
  ProblemStatus,
  ProblemType,
  ProblemVisibility
} from "@nojv/core";

export function formatVerdictLabel(verdict: string): string {
  return verdict.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export const difficultyColor: Record<string, string> = {
  easy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  hard: "bg-red-500/15 text-red-700 dark:text-red-400"
};

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
   * `Problem.type` in the schema; `special_env` replaces the legacy
   * `mode === "advanced"`.
   */
  type: ProblemType;
  samples: {
    stdin: string;
    expected: string;
  }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  status: ProblemStatus;
  tags: string[];
  timeLimitMs: number;
  visibility: ProblemVisibility;
  /** special_env only. Null for other problem types. */
  advancedImageRef: string | null;
  advancedImageSource: ProblemImageSource | null;
  /** Only meaningful when type === "special_env". */
  networkEnabled: boolean;
  /**
   * Workspace files for the student editor. Hidden files are included so
   * the UI can render their metadata (path, language, description), but
   * their `content` is always `""` — the domain layer blanks it before it
   * leaves the server.
   */
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
