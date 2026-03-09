import {
  type CourseAssessmentType,
  type CourseRole,
  type EffectiveCourseRole,
  type PlatformRole
} from "@nojv/domain";

export interface EffectiveCourseRoleInput {
  courseRole?: CourseRole;
  platformRole: PlatformRole;
}

export type AssessmentWindowState = "upcoming" | "open" | "grace" | "closed";

export interface AssessmentWindowStateInput {
  closesAt: string;
  dueAt: string;
  now?: string;
  opensAt: string;
}

export interface AssessmentPresentation {
  heroLabel: string;
  supportLabel: string;
}

export function resolveEffectiveCourseRole({
  courseRole,
  platformRole
}: EffectiveCourseRoleInput): EffectiveCourseRole {
  if (platformRole === "admin") {
    return "admin";
  }

  return courseRole ?? platformRole;
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

export function deriveAssessmentPresentation(input: {
  scoreboardMode: "frozen" | "hidden" | "live";
  type: CourseAssessmentType;
}): AssessmentPresentation {
  if (input.type === "exam") {
    return {
      heroLabel:
        input.scoreboardMode === "frozen"
          ? "Frozen rank exam surface"
          : "Live rank exam surface",
      supportLabel: "Contest-grade timing, policy, and score visibility"
    };
  }

  return {
    heroLabel: "Deadline-driven assignment workspace",
    supportLabel: "Coursework framing with open, due, and close windows"
  };
}
