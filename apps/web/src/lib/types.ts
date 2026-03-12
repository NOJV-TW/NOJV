import type {
  CourseAssessmentType,
  JudgeType,
  Language,
  ProblemOverview,
  SubmissionType
} from "@nojv/core";

// --- Problem types ---

export interface TemplateInfo {
  driverCode: string;
  insertionMarker: string;
  templateCode: string;
}

export interface ProblemDetail extends ProblemOverview {
  authorHandle: string;
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
  visibility: "private" | "public";
}

export interface ContestDetail {
  endsAt: string;
  frozenScoreboard: boolean;
  mode: string;
  problems: {
    points: number;
    slug: string;
    title: string;
  }[];
  slug: string;
  startsAt: string;
  summary: string;
  title: string;
}

export const starterByLanguage: Record<Language, string> = {
  c: `#include <stdio.h>

int main(void) {
  int a = 0;
  int b = 0;
  if (scanf("%d %d", &a, &b) != 2) {
    return 0;
  }
  printf("%d\\n", a + b);
  return 0;
}
`,
  go: `package main

import "fmt"

func main() {
  var a, b int
  fmt.Scan(&a, &b)
  fmt.Println(a + b)
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);

  int a = 0;
  int b = 0;
  cin >> a >> b;
  cout << a + b << "\\n";
}
`,
  java: `import java.util.Scanner;

public class Main {
  public static void main(String[] args) {
    Scanner scanner = new Scanner(System.in);
    int a = scanner.nextInt();
    int b = scanner.nextInt();
    System.out.println(a + b);
  }
}
`,
  javascript: `const fs = require("node:fs");

const [a, b] = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);
console.log(a + b);
`,
  python: `a, b = map(int, input().split())
print(a + b)
`,
  rust: `use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let values: Vec<i32> = input.split_whitespace().map(|v| v.parse().unwrap()).collect();
    println!("{}", values[0] + values[1]);
}
`,
  typescript: `import { readFileSync } from "node:fs";

const [a, b] = readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);
console.log(a + b);
`
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

// --- Assessment helpers ---

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
