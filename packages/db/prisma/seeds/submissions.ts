import { randomUUID } from "node:crypto";

import { entryFileNameFor } from "@nojv/core";
import {
  createStorageClient,
  planSubmissionSources,
  putSubmissionSourcePlan,
  putVerdictDetail,
  type SubmissionSource,
} from "@nojv/storage";
import type { S3Client } from "@aws-sdk/client-s3";

import type { Prisma, PrismaClient, User } from "../../generated/prisma/client";
import type { SubmissionStatus } from "../../generated/prisma/enums";
import {
  buildVerdictDetail,
  DAY,
  deriveSeedVerdictSummary,
  HOUR,
  loadProblemTestcases,
  sampleSource,
  SeededRng,
  type LongVerdict,
  type ProblemTestcases,
  type SeedLanguage,
} from "./demo-helpers";
import type { SubmissionResult } from "@nojv/core";

const COURSE_ID = "course_os-lab-spring-2026";

const PRACTICE_VERDICTS: LongVerdict[] = [
  "accepted",
  "accepted",
  "accepted",
  "wrong_answer",
  "wrong_answer",
  "time_limit_exceeded",
  "runtime_error",
  "memory_limit_exceeded",
  "compile_error",
];

const PUBLIC_PRACTICE_PROBLEMS = [
  "problem_warmup-sum",
  "problem_add-two-numbers",
  "problem_graph-docking",
  "problem_float-compare",
  "problem_guess-the-number",
  "problem_distributed-labyrinth",
  "problem_stateful-dhcp-parser",
  "problem_memory-leak-forensics",
  "problem_noisy-oracle-hunt",
] as const;

const LANGS: SeedLanguage[] = ["c", "cpp", "python"];

type SubmissionRow = Omit<
  Prisma.SubmissionCreateManyInput,
  "sourceStorage" | "verdictDetailStorage"
>;

type SeedSubmission = {
  id: string;
  row: SubmissionRow;
  sources: SubmissionSource[];
  detail: SubmissionResult;
};

function statusFor(verdict: LongVerdict): SubmissionStatus {
  return verdict;
}

function makeSubmission(args: {
  rng: SeededRng;
  userId: string;
  problemId: string;
  testcases: ProblemTestcases;
  verdict: LongVerdict;
  createdAt: Date;
  language?: SeedLanguage;
  sampleOnly?: boolean;
  context?:
    | { kind: "practice" }
    | { kind: "assignment"; assessmentId: string }
    | { kind: "exam"; examId: string }
    | { kind: "contest"; contestId: string };
}): SeedSubmission {
  const { rng, userId, problemId, testcases, verdict, createdAt } = args;
  const language = args.language ?? rng.pick(LANGS);
  const { detail, score, runtimeMs, memoryKb } = buildVerdictDetail({
    verdict,
    language,
    testcases,
    rng,
  });

  const id = randomUUID();
  const sources: SubmissionSource[] = [
    { path: entryFileNameFor(language), content: sampleSource(language, verdict) },
  ];

  const row: SubmissionRow = {
    id,
    userId,
    problemId,
    language,
    status: statusFor(verdict),
    score,
    runtimeMs,
    memoryKb,
    verdictSummary: deriveSeedVerdictSummary(detail) as unknown as Prisma.InputJsonValue,
    sampleOnly: args.sampleOnly ?? false,
    createdAt,
  };

  const ctx = args.context ?? { kind: "practice" };
  if (ctx.kind === "assignment") {
    row.courseId = COURSE_ID;
    row.assessmentId = ctx.assessmentId;
  } else if (ctx.kind === "exam") {
    row.examId = ctx.examId;
  } else if (ctx.kind === "contest") {
    row.contestId = ctx.contestId;
  }

  return { id, row, sources, detail };
}

async function persistSeedSubmissions(
  prisma: PrismaClient,
  storage: S3Client,
  subs: SeedSubmission[],
): Promise<void> {
  if (subs.length === 0) return;
  const prepared: Prisma.SubmissionCreateManyInput[] = [];
  for (const submission of subs) {
    const sourcePlan = planSubmissionSources(submission.id, randomUUID(), submission.sources);
    const sourceStorage = await putSubmissionSourcePlan(storage, sourcePlan);
    const verdictDetailStorage = await putVerdictDetail(
      storage,
      submission.id,
      `seed-${randomUUID()}`,
      submission.detail,
    );
    prepared.push({ ...submission.row, sourceStorage, verdictDetailStorage });
  }
  await prisma.submission.createMany({ data: prepared });
}

export async function seedSubmissions(
  prisma: PrismaClient,
  refs: { admin: User; student: User; demoStudents: User[] },
): Promise<void> {
  const now = Date.now();
  const { admin, student, demoStudents } = refs;
  const storage = createStorageClient();

  await prisma.submission.deleteMany({});
  await prisma.participation.deleteMany({});

  const problemIds = new Set<string>([
    ...PUBLIC_PRACTICE_PROBLEMS,
    "problem_process-log-parser",
    "problem_fork-bomb-safeguard",
  ]);
  const testcasesById = new Map<string, ProblemTestcases>();
  for (const pid of problemIds) {
    testcasesById.set(pid, await loadProblemTestcases(prisma, pid));
  }
  const tc = (pid: string): ProblemTestcases =>
    testcasesById.get(pid) ?? { sets: [], flatTestcaseIds: [] };

  const subs: SeedSubmission[] = [];

  const mainRng = new SeededRng(0x5eed_0001);
  for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
    const isRecent = dayOffset <= 4;
    const active = isRecent || mainRng.chance(0.55);
    if (!active) continue;

    const perDay = isRecent ? mainRng.int(2, 4) : mainRng.int(1, 3);
    for (let k = 0; k < perDay; k++) {
      const problemId = mainRng.pick(PUBLIC_PRACTICE_PROBLEMS);
      const verdict = mainRng.pick(PRACTICE_VERDICTS);
      const within =
        dayOffset === 0
          ? now - mainRng.int(5, 55) * 60 * 1000
          : now - dayOffset * DAY + mainRng.int(8, 22) * HOUR + mainRng.int(0, 59) * 60 * 1000;
      subs.push(
        makeSubmission({
          rng: mainRng,
          userId: student.id,
          problemId,
          testcases: tc(problemId),
          verdict,
          createdAt: new Date(within),
        }),
      );
    }
  }

  for (let i = 0; i < 4; i++) {
    const problemId = mainRng.pick(PUBLIC_PRACTICE_PROBLEMS);
    subs.push(
      makeSubmission({
        rng: mainRng,
        userId: student.id,
        problemId,
        testcases: tc(problemId),
        verdict: mainRng.chance(0.5) ? "accepted" : "wrong_answer",
        createdAt: new Date(now - mainRng.int(1, 6) * DAY - mainRng.int(0, 12) * HOUR),
        sampleOnly: true,
      }),
    );
  }

  const adminRng = new SeededRng(0x5eed_ad01);
  for (let dayOffset = 180; dayOffset >= 0; dayOffset--) {
    const isRecent = dayOffset <= 3;
    const active = isRecent || adminRng.chance(0.6);
    if (!active) continue;

    const perDay = isRecent ? adminRng.int(2, 5) : adminRng.int(1, 4);
    for (let k = 0; k < perDay; k++) {
      const problemId = adminRng.pick(PUBLIC_PRACTICE_PROBLEMS);
      const verdict = adminRng.pick(PRACTICE_VERDICTS);
      const within =
        dayOffset === 0
          ? now - adminRng.int(5, 55) * 60 * 1000
          : now -
            dayOffset * DAY +
            adminRng.int(8, 22) * HOUR +
            adminRng.int(0, 59) * 60 * 1000;
      subs.push(
        makeSubmission({
          rng: adminRng,
          userId: admin.id,
          problemId,
          testcases: tc(problemId),
          verdict,
          createdAt: new Date(within),
        }),
      );
    }
  }

  demoStudents.slice(0, 4).forEach((s, idx) => {
    const rng = new SeededRng(0x5eed_1000 + idx);
    for (let dayOffset = 40; dayOffset >= 0; dayOffset--) {
      if (!rng.chance(0.35)) continue;
      const problemId = rng.pick(PUBLIC_PRACTICE_PROBLEMS);
      const verdict = rng.pick(PRACTICE_VERDICTS);
      const when = now - dayOffset * DAY + rng.int(9, 21) * HOUR;
      subs.push(
        makeSubmission({
          rng,
          userId: s.id,
          problemId,
          testcases: tc(problemId),
          verdict,
          createdAt: new Date(when),
        }),
      );
    }
  });

  const HW1_ID = "hw1-process-trace";
  const HW2_ID = "hw2-signal-handling";
  const HW1_PROBLEMS = ["problem_warmup-sum", "problem_process-log-parser"] as const;
  const HW1_OPEN = new Date("2026-03-17T09:00:00.000Z").getTime();
  const HW1_DUE = new Date("2026-03-23T15:00:00.000Z").getTime();
  const HW1_CLOSE = new Date("2026-03-25T15:00:00.000Z").getTime();
  const HW2_OPEN = new Date("2026-04-16T09:00:00.000Z").getTime();
  const HW2_CLOSE = new Date("2026-04-30T15:00:00.000Z").getTime();

  const HW2_LANGS: SeedLanguage[] = ["c", "cpp"];

  const courseworkStudents = [student, ...demoStudents];

  courseworkStudents.forEach((s, idx) => {
    const rng = new SeededRng(0x5eed_2000 + idx);

    for (const problemId of HW1_PROBLEMS) {
      const attempts = rng.int(1, 3);
      for (let a = 0; a < attempts; a++) {
        const verdict =
          a === attempts - 1 ? pickAssignmentFinal(rng) : pickAssignmentEarly(rng);
        const late = a === attempts - 1 && rng.chance(0.25);
        const when = late
          ? HW1_DUE + rng.int(1, Math.floor((HW1_CLOSE - HW1_DUE) / HOUR)) * HOUR
          : HW1_OPEN + rng.int(1, Math.floor((HW1_DUE - HW1_OPEN) / HOUR)) * HOUR;
        subs.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict,
            createdAt: new Date(when),
            context: { kind: "assignment", assessmentId: HW1_ID },
          }),
        );
      }
    }

    const hw2Attempts = rng.int(1, 3);
    for (let a = 0; a < hw2Attempts; a++) {
      const verdict =
        a === hw2Attempts - 1 ? pickAssignmentFinal(rng) : pickAssignmentEarly(rng);
      const when = HW2_OPEN + rng.int(1, Math.floor((HW2_CLOSE - HW2_OPEN) / HOUR)) * HOUR;
      subs.push(
        makeSubmission({
          rng,
          userId: s.id,
          problemId: "problem_add-two-numbers",
          testcases: tc("problem_add-two-numbers"),
          verdict,
          createdAt: new Date(when),
          language: rng.pick(HW2_LANGS),
          context: { kind: "assignment", assessmentId: HW2_ID },
        }),
      );
    }
  });

  const EXAM_ID = "exam_midterm-systems-lab";
  const EXAM_PROBLEMS = [
    "problem_graph-docking",
    "problem_fork-bomb-safeguard",
    "problem_memory-leak-forensics",
  ] as const;
  const EXAM_START = new Date("2026-04-18T09:00:00.000Z").getTime();
  const EXAM_END = new Date("2026-04-18T11:00:00.000Z").getTime();
  const EXAM_LANGS: SeedLanguage[] = ["c", "cpp"];

  const examStudents = [student, ...demoStudents.slice(0, 6)];
  examStudents.forEach((s, idx) => {
    const rng = new SeededRng(0x5eed_3000 + idx);
    const problemCount = rng.int(1, EXAM_PROBLEMS.length);
    for (let p = 0; p < problemCount; p++) {
      const problemId = EXAM_PROBLEMS[p]!;
      const attempts = rng.int(1, 2);
      for (let a = 0; a < attempts; a++) {
        const verdict =
          a === attempts - 1 ? pickAssignmentFinal(rng) : pickAssignmentEarly(rng);
        const when =
          EXAM_START +
          rng.int(2, Math.floor((EXAM_END - EXAM_START) / (60 * 1000)) - 2) * 60 * 1000;
        subs.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict,
            createdAt: new Date(when),
            language: rng.pick(EXAM_LANGS),
            context: { kind: "exam", examId: EXAM_ID },
          }),
        );
      }
    }
  });

  await persistSeedSubmissions(prisma, storage, subs);

  await seedContestSubmissions(prisma, storage, {
    contestId: "spring-qualifier-2026",
    problems: ["problem_warmup-sum", "problem_graph-docking"],
    students: [student, ...demoStudents.slice(0, 8)],
    startsAt: new Date("2026-03-15T14:00:00+08:00"),
    endsAt: new Date("2026-03-15T18:00:00+08:00"),
    submissionTimeFor: (rng) => {
      const start = new Date("2026-03-15T14:00:00+08:00").getTime();
      const end = new Date("2026-03-15T18:00:00+08:00").getTime();
      return start + rng.int(1, Math.floor((end - start) / (60 * 1000)) - 1) * 60 * 1000;
    },
    rngBase: 0x5eed_4000,
    tc,
  });

  await seedContestSubmissions(prisma, storage, {
    contestId: "contest_demo_live",
    problems: ["problem_warmup-sum", "problem_add-two-numbers"],
    students: [student, ...demoStudents.slice(0, 6)],
    startsAt: new Date(now - HOUR),
    endsAt: new Date(now + 2 * HOUR),
    submissionTimeFor: (rng) => now - rng.int(2, 58) * 60 * 1000,
    rngBase: 0x5eed_5000,
    tc,
  });

  console.log(
    `  Submissions: ${subs.length} practice/assignment/exam rows + contest rows for 2 contests`,
  );
}

function pickAssignmentEarly(rng: SeededRng): LongVerdict {
  return rng.pick([
    "wrong_answer",
    "wrong_answer",
    "runtime_error",
    "time_limit_exceeded",
    "compile_error",
    "accepted",
  ]);
}

function pickAssignmentFinal(rng: SeededRng): LongVerdict {
  return rng.pick(["accepted", "accepted", "accepted", "wrong_answer", "time_limit_exceeded"]);
}

async function seedContestSubmissions(
  prisma: PrismaClient,
  storage: S3Client,
  args: {
    contestId: string;
    problems: string[];
    students: User[];
    startsAt: Date;
    endsAt: Date;
    submissionTimeFor: (rng: SeededRng) => number;
    rngBase: number;
    tc: (pid: string) => ProblemTestcases;
  },
): Promise<void> {
  const { contestId, problems, students, startsAt, submissionTimeFor, rngBase, tc } = args;

  for (const [idx, s] of students.entries()) {
    const rng = new SeededRng(rngBase + idx);

    const participation = await prisma.participation.create({
      data: {
        type: "contest",
        contestId,
        userId: s.id,
        status: "active",
        startedAt: startsAt,
        score: 0,
        penaltySeconds: 0,
      },
    });

    const contestSubs: SeedSubmission[] = [];
    let solvedCount = 0;
    let totalPenalty = 0;

    for (const problemId of problems) {
      const willSolve = rng.chance(0.7);
      const wrongAttempts = willSolve ? rng.int(0, 2) : rng.int(1, 3);

      for (let a = 0; a < wrongAttempts; a++) {
        const verdict = rng.pick<LongVerdict>([
          "wrong_answer",
          "runtime_error",
          "time_limit_exceeded",
        ]);
        contestSubs.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict,
            createdAt: new Date(submissionTimeFor(rng)),
            context: { kind: "contest", contestId },
          }),
        );
      }

      if (willSolve) {
        const acTime = submissionTimeFor(rng);
        contestSubs.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict: "accepted",
            createdAt: new Date(acTime),
            context: { kind: "contest", contestId },
          }),
        );
        solvedCount++;
        const minutesToAc = Math.max(
          0,
          Math.round((acTime - startsAt.getTime()) / (60 * 1000)),
        );
        totalPenalty += minutesToAc * 60 + wrongAttempts * 20 * 60;
      }
    }

    await persistSeedSubmissions(prisma, storage, contestSubs);

    await prisma.participation.update({
      where: { id: participation.id },
      data: { score: solvedCount, penaltySeconds: totalPenalty },
    });
  }
}
