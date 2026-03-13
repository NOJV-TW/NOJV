import type {
  AssessmentScoreboardMode,
  CourseAssessmentType,
  JudgeType,
  Language,
  ProblemOverview,
  ProblemVisibility,
  SubmissionType
} from "@nojv/core";

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

export const starterByLanguage: Record<Language, string> = {
  c: `#include <stdio.h>

int main() {

}
`,
  go: `package main

func main() {
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {

}
`,
  java: `import java.util.Scanner;

public class Main {
  public static void main(String[] args) {

  }
}
`,
  rust: `use std::io::{self, Read};

fn main() {

}
`,
  javascript: ``,
  typescript: ``,
  python: ``
};

// --- Verdict display ---

export const verdictColor: Record<string, string> = {
  accepted: "text-emerald-600",
  compile_error: "text-amber-600",
  memory_limit_exceeded: "text-red-600",
  runtime_error: "text-amber-600",
  time_limit_exceeded: "text-red-600",
  wrong_answer: "text-red-600"
};

export function formatVerdictLabel(verdict: string): string {
  return verdict.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// --- Route helpers ---

export function assessmentPath(
  courseSlug: string,
  type: CourseAssessmentType,
  assessmentSlug: string
): string {
  const segment = type === "exam" ? "exams" : "assignments";
  return `/courses/${courseSlug}/${segment}/${assessmentSlug}`;
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
  grace: "text-amber-600",
  open: "text-emerald-600",
  upcoming: "text-blue-600"
};

export function windowStateColorClass(state: AssessmentWindowState) {
  return windowStateColors[state];
}

export function deriveAssessmentPresentation(input: {
  scoreboardMode: AssessmentScoreboardMode;
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
