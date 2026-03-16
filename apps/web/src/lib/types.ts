import type {
  JudgeType,
  Language,
  ProblemOverview,
  ProblemVisibility,
  SubmissionType
} from "@nojv/core";

export { formatVerdictLabel, starterByLanguage } from "@nojv/core";

// --- Problem types ---

export interface TemplateInfo {
  driverCode: string;
  insertionMarker: string;
  templateCode: string;
}

export interface ProblemDetail extends ProblemOverview {
  authorUsername: string;
  checkerScript?: string;
  inputFormat: string;
  interactorScript?: string;
  judgeType: JudgeType;
  memoryLimitMb: number;
  outputFormat: string;
  samples: {
    explanation: string;
    input: string;
    output: string;
  }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  submissionType: SubmissionType;
  summary: string;
  tags: string[];
  templates: Partial<Record<Language, TemplateInfo>>;
  timeLimitMs: number;
  visibility: ProblemVisibility;
}

// --- Verdict display ---

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

// --- Route helpers ---

export function assessmentPath(courseSlug: string, assessmentSlug: string): string {
  return `/courses/${courseSlug}/assignments/${assessmentSlug}`;
}

// --- Assessment helpers ---

export type AssessmentWindowState = "upcoming" | "open" | "grace" | "closed";

interface AssessmentWindowStateInput {
  closesAt: string;
  dueAt: string;
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
  const dueDate = new Date(dueAt);
  const closesDate = new Date(closesAt);

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
