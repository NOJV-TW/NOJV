import type {
  CaseResult,
  SubmissionResult,
  SubtaskResultItem,
  VerdictSummary,
} from "@nojv/core";

import type { PrismaClient } from "../../generated/prisma/client";

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export type LongVerdict =
  | "accepted"
  | "wrong_answer"
  | "compile_error"
  | "runtime_error"
  | "time_limit_exceeded"
  | "memory_limit_exceeded";

export type ShortVerdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "SE";

const LONG_TO_SHORT: Record<Exclude<LongVerdict, "accepted">, ShortVerdict> = {
  wrong_answer: "WA",
  compile_error: "CE",
  runtime_error: "RE",
  time_limit_exceeded: "TLE",
  memory_limit_exceeded: "MLE",
};

export type SeedLanguage = "c" | "cpp" | "python";

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
}

export function sampleSource(language: SeedLanguage, verdict: LongVerdict): string {
  if (language === "python") {
    if (verdict === "compile_error") {
      return "import sys\ndef main(\n    a, b = map(int, input().split())\n    print(a + b)\n";
    }
    return 'import sys\n\n\ndef main():\n    a, b = map(int, sys.stdin.read().split())\n    print(a + b)\n\n\nif __name__ == "__main__":\n    main()\n';
  }
  if (language === "c") {
    if (verdict === "compile_error") {
      return '#include <stdio.h>\nint main(void) {\n    int a, b\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n';
    }
    return '#include <stdio.h>\n\nint main(void) {\n    long long a, b;\n    scanf("%lld %lld", &a, &b);\n    printf("%lld\\n", a + b);\n    return 0;\n}\n';
  }
  if (verdict === "compile_error") {
    return "#include <iostream>\nint main() {\n    long long a, b\n    std::cin >> a >> b;\n    std::cout << a + b << '\\n';\n}\n";
  }
  return "#include <iostream>\n\nint main() {\n    long long a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << '\\n';\n    return 0;\n}\n";
}

const FEEDBACK: Record<LongVerdict, string> = {
  accepted: "All testcases passed.",
  wrong_answer: "Output did not match the expected answer on at least one testcase.",
  compile_error: "",
  runtime_error: "The program crashed with a non-zero exit code during execution.",
  time_limit_exceeded: "Execution exceeded the time limit on at least one testcase.",
  memory_limit_exceeded: "Execution exceeded the memory limit on at least one testcase.",
};

const COMPILER_OUTPUT: Record<SeedLanguage, string> = {
  python:
    "  File \"main.py\", line 2\n    def main(\n            ^\nSyntaxError: '(' was never closed",
  c: "main.c: In function 'main':\nmain.c:3:18: error: expected ';' before 'scanf'\n    3 |     int a, b\n      |                  ^",
  cpp: "main.cpp: In function 'int main()':\nmain.cpp:3:20: error: expected ';' before 'std'\n    3 |     long long a, b\n      |                    ^",
};

export type ProblemTestcases = {
  sets: Array<{
    testcaseSetId: string;
    name: string;
    weight: number;
    testcaseIds: string[];
  }>;
  flatTestcaseIds: string[];
};

export async function loadProblemTestcases(
  prisma: PrismaClient,
  problemId: string,
): Promise<ProblemTestcases> {
  const sets = await prisma.testcaseSet.findMany({
    where: { problemId },
    orderBy: { ordinal: "asc" },
    include: { testcases: { orderBy: { ordinal: "asc" } } },
  });

  const mappedSets = sets.map((set) => ({
    testcaseSetId: set.id,
    name: set.name,
    weight: set.weight,
    testcaseIds: set.testcases.map((tc) => tc.id),
  }));

  return {
    sets: mappedSets,
    flatTestcaseIds: mappedSets.flatMap((s) => s.testcaseIds),
  };
}

function caseResult(
  index: number,
  verdict: ShortVerdict,
  rng: SeededRng,
  testcaseId?: string,
): CaseResult {
  const base: CaseResult = {
    index,
    verdict,
    timeMs: verdict === "TLE" ? rng.int(2000, 3000) : rng.int(4, 180),
    memoryKb: verdict === "MLE" ? rng.int(260_000, 520_000) : rng.int(2_000, 48_000),
  };
  return testcaseId ? { ...base, testcaseId } : base;
}

export function buildVerdictDetail(args: {
  verdict: LongVerdict;
  language: SeedLanguage;
  testcases: ProblemTestcases;
  rng: SeededRng;
}): { detail: SubmissionResult; score: number; runtimeMs: number; memoryKb: number } {
  const { verdict, language, testcases, rng } = args;

  if (verdict === "compile_error") {
    const detail: SubmissionResult = {
      accepted: false,
      caseResults: [],
      feedback: COMPILER_OUTPUT[language],
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error",
    };
    return { detail, score: 0, runtimeMs: 0, memoryKb: 0 };
  }

  const shortFail = verdict === "accepted" ? "AC" : LONG_TO_SHORT[verdict];
  const useSubtasks = testcases.sets.length > 1;

  if (useSubtasks) {
    const totalSets = testcases.sets.length;
    const passingSets =
      verdict === "accepted" ? totalSets : rng.int(0, Math.max(0, totalSets - 1));

    const totalWeight = testcases.sets.reduce((sum, s) => sum + s.weight, 0) || 1;
    let earnedWeight = 0;
    let maxRuntime = 0;
    let maxMemory = 0;

    const subtaskResults: SubtaskResultItem[] = testcases.sets.map((set, setIndex) => {
      const passed = setIndex < passingSets;
      if (passed) earnedWeight += set.weight;

      const failCaseIndex = passed ? -1 : rng.int(0, Math.max(0, set.testcaseIds.length - 1));
      const cases: CaseResult[] = set.testcaseIds.map((tcId, i) => {
        const cv: ShortVerdict = i === failCaseIndex ? shortFail : "AC";
        const cr = caseResult(i, cv, rng, tcId);
        maxRuntime = Math.max(maxRuntime, cr.timeMs);
        if (cr.memoryKb !== undefined) maxMemory = Math.max(maxMemory, cr.memoryKb);
        return cr;
      });

      return {
        cases,
        label: set.name,
        passed,
        testcaseSetId: set.testcaseSetId,
        weight: set.weight,
      };
    });

    const score = verdict === "accepted" ? totalWeight : earnedWeight;
    const accepted = verdict === "accepted";

    const detail: SubmissionResult = {
      accepted,
      feedback: accepted ? FEEDBACK.accepted : FEEDBACK[verdict],
      runtimeMs: maxRuntime,
      memoryKb: maxMemory,
      score,
      subtaskResults,
      verdict,
    };
    return { detail, score, runtimeMs: maxRuntime, memoryKb: maxMemory };
  }

  const ids =
    testcases.flatTestcaseIds.length > 0
      ? testcases.flatTestcaseIds
      : Array.from({ length: 4 }, () => undefined);
  const failIndex = verdict === "accepted" ? -1 : rng.int(0, ids.length - 1);

  let maxRuntime = 0;
  let maxMemory = 0;
  const caseResults: CaseResult[] = ids.map((tcId, i) => {
    const cv: ShortVerdict = i === failIndex ? shortFail : "AC";
    const cr = caseResult(i, cv, rng, tcId);
    maxRuntime = Math.max(maxRuntime, cr.timeMs);
    if (cr.memoryKb !== undefined) maxMemory = Math.max(maxMemory, cr.memoryKb);
    return cr;
  });

  const accepted = verdict === "accepted";
  const totalWeight = testcases.sets.reduce((sum, s) => sum + s.weight, 0);
  const score = accepted ? (totalWeight > 0 ? totalWeight : 100) : 0;

  const detail: SubmissionResult = {
    accepted,
    caseResults,
    feedback: accepted ? FEEDBACK.accepted : FEEDBACK[verdict],
    runtimeMs: maxRuntime,
    memoryKb: maxMemory,
    score,
    verdict,
  };
  return { detail, score, runtimeMs: maxRuntime, memoryKb: maxMemory };
}

const SUMMARY_VERDICTS = new Set(["AC", "WA", "TLE", "MLE", "RE"]);

export function deriveSeedVerdictSummary(result: SubmissionResult): VerdictSummary {
  const caseSummary = { ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 };
  for (const c of result.caseResults ?? []) {
    const v = c.verdict.toUpperCase();
    if (SUMMARY_VERDICTS.has(v)) {
      if (v === "AC") caseSummary.ac += 1;
      else if (v === "WA") caseSummary.wa += 1;
      else if (v === "TLE") caseSummary.tle += 1;
      else if (v === "MLE") caseSummary.mle += 1;
      else if (v === "RE") caseSummary.re += 1;
    } else {
      caseSummary.other += 1;
    }
  }
  const summary: VerdictSummary = { caseSummary };
  if (result.subtaskResults && result.subtaskResults.length > 0) {
    summary.subtaskSummary = result.subtaskResults.map((s) => ({
      id: s.testcaseSetId,
      score: s.passed ? s.weight : 0,
    }));
  }
  if (result.verdict === "compile_error" && result.feedback) {
    summary.compilerErrorTruncated = result.feedback.slice(0, 1024);
  }
  return summary;
}
