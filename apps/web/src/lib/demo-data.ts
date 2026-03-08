import type { IntegrityCase, Language, ProblemOverview } from "@nojv/domain";

export interface ProblemDetail extends ProblemOverview {
  authorHandle: string;
  samples: {
    explanation: string;
    input: string;
    output: string;
  }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  summary: string;
  tags: string[];
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
  telemetrySensitivity: string;
  title: string;
  workspacePolicy: string;
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

export const problemDetails: ProblemDetail[] = [
  {
    acceptanceRate: 0.61,
    authorHandle: "teacher_amelia",
    difficulty: "easy",
    samples: [
      {
        explanation: "Read two integers and print their sum.",
        input: "2 5",
        output: "7"
      }
    ],
    slug: "warmup-sum",
    starterByLanguage,
    statement:
      "Implement the classic warmup judge task. Read exactly two integers from standard input and print their sum followed by a newline.",
    summary:
      "The sandbox-backed testcase judge uses this task to exercise the editor, queue, and submission lifecycle.",
    tags: ["implementation", "warmup"],
    title: "Warmup Sum",
    totalSubmissions: 18420,
    visibility: "public"
  },
  {
    acceptanceRate: 0.43,
    authorHandle: "teacher_amelia",
    difficulty: "medium",
    samples: [
      {
        explanation: "Dock every ship at the earliest valid gate.",
        input: "4\n3\n4\n1\n1\n",
        output: "2"
      }
    ],
    slug: "graph-docking",
    starterByLanguage,
    statement:
      "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches.",
    summary: "A medium problem used to show richer catalog metadata on the problem page.",
    tags: ["dsu", "greedy"],
    title: "Graph Docking",
    totalSubmissions: 9274,
    visibility: "public"
  },
  {
    acceptanceRate: 0.19,
    authorHandle: "teacher_amelia",
    difficulty: "hard",
    samples: [
      {
        explanation: "Count the number of shortest synchronized paths across the maze layers.",
        input: "3 3\n...\n.#.\n...\n",
        output: "4"
      }
    ],
    slug: "distributed-labyrinth",
    starterByLanguage,
    statement:
      "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch.",
    summary:
      "A hard graph problem that showcases the catalog's ability to carry richer editorial metadata and higher-difficulty workloads.",
    tags: ["graph", "shortest-path", "state-compression"],
    title: "Distributed Labyrinth",
    totalSubmissions: 2140,
    visibility: "public"
  },
  {
    acceptanceRate: 0.0,
    authorHandle: "teacher_amelia",
    difficulty: "medium",
    samples: [
      {
        explanation: "Students must normalize a process trace before diffing lifecycle events.",
        input: "3\nfork 1 2\nexit 2\nwait 1\n",
        output: "1->2 forked\n2 exited\n1 waited\n"
      }
    ],
    slug: "process-log-parser",
    starterByLanguage,
    statement:
      "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage.",
    summary:
      "A private course problem for assignments where the public catalog should not reveal the prompt.",
    tags: ["parser", "systems"],
    title: "Process Log Parser",
    totalSubmissions: 0,
    visibility: "private"
  },
  {
    acceptanceRate: 0.0,
    authorHandle: "teacher_amelia",
    difficulty: "hard",
    samples: [
      {
        explanation: "Score the process tree by the safest rollback strategy.",
        input: "4\n1 2\n1 3\n3 4\n",
        output: "7"
      }
    ],
    slug: "fork-bomb-safeguard",
    starterByLanguage,
    statement:
      "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam.",
    summary: "A private exam problem that should only surface inside a course assessment.",
    tags: ["tree-dp", "systems", "exam"],
    title: "Fork Bomb Safeguard",
    totalSubmissions: 0,
    visibility: "private"
  }
];

export const problemCards: ProblemOverview[] = problemDetails
  .map(({ acceptanceRate, difficulty, slug, title, totalSubmissions, visibility }) =>
    visibility === "public"
      ? {
          acceptanceRate,
          difficulty,
          slug,
          title,
          totalSubmissions
        }
      : null
  )
  .filter((problem): problem is ProblemOverview => problem !== null);

export const contestDetails: ContestDetail[] = [
  {
    endsAt: "2026-03-15 18:00",
    frozenScoreboard: true,
    mode: "ICPC Scoreboard Freeze",
    problems: [
      {
        points: 100,
        slug: "warmup-sum",
        title: "Warmup Sum"
      },
      {
        points: 300,
        slug: "graph-docking",
        title: "Graph Docking"
      }
    ],
    slug: "spring-qualifier-2026",
    startsAt: "2026-03-15 14:00",
    summary:
      "Qualifier contest with a frozen board in the final hour. Contest telemetry escalates shell-policy and concurrent-session events aggressively.",
    telemetrySensitivity: "High",
    title: "Spring Qualifier 2026",
    workspacePolicy: "make, compiler, and runtime commands only"
  },
  {
    endsAt: "2026-03-22 21:00",
    frozenScoreboard: false,
    mode: "Course Assignment Arena",
    problems: [
      {
        points: 100,
        slug: "warmup-sum",
        title: "Warmup Sum"
      },
      {
        points: 500,
        slug: "distributed-labyrinth",
        title: "Distributed Labyrinth"
      }
    ],
    slug: "systems-lab-midterm",
    startsAt: "2026-03-22 18:00",
    summary:
      "Assignment-flavored contest where participants keep an isolated workspace but still submit through a contest-specific scoring surface.",
    telemetrySensitivity: "Medium",
    title: "Systems Lab Midterm",
    workspacePolicy: "make plus course scripts"
  }
];

export const contestCards = contestDetails.map(({ endsAt, mode, slug, startsAt, title }) => ({
  endsAt,
  mode,
  slug,
  startsAt,
  title
}));

export const integrityCases: IntegrityCase[] = [
  {
    caseId: "case_focus_shift",
    score: 82,
    signalCount: 4,
    state: "under_review",
    userId: "usr_1048"
  },
  {
    caseId: "case_similarity_cluster",
    score: 94,
    signalCount: 7,
    state: "open",
    userId: "usr_2083"
  },
  {
    caseId: "case_ip_handoff",
    score: 58,
    signalCount: 3,
    state: "resolved",
    userId: "usr_3191"
  }
];

export const queueSeries = {
  categories: ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"],
  integrity: [8, 9, 13, 17, 14, 16],
  submission: [41, 53, 66, 88, 79, 91],
  workspace: [14, 21, 26, 34, 31, 42]
} as const;

export function getProblemDetail(slug: string) {
  return problemDetails.find((problem) => problem.slug === slug);
}

export function getContestDetail(slug: string) {
  return contestDetails.find((contest) => contest.slug === slug);
}
