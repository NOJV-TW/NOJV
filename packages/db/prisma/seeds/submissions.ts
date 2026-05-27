import { scoreboard } from "@nojv/redis";

import type { Prisma, PrismaClient, User } from "../../generated/prisma/client";
import type { SubmissionStatus } from "../../generated/prisma/enums";
import {
  buildVerdictDetail,
  DAY,
  HOUR,
  loadProblemTestcases,
  sampleSource,
  SeededRng,
  type LongVerdict,
  type ProblemTestcases,
  type SeedLanguage,
} from "./demo-helpers";

const COURSE_ID = "course_os-lab-spring-2026";

// Verdict mix used to drive the practice activity. Weighted toward AC so the
// heatmap looks like a real, mostly-succeeding student while still covering
// every verdict for the demo.
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

type SubmissionRow = Prisma.SubmissionCreateManyInput;

/** Convert a SubmissionResult verdict into the SubmissionStatus enum value. */
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
    | { kind: "assignment"; courseAssessmentId: string }
    | { kind: "exam"; examId: string }
    | { kind: "contest"; contestId: string; contestParticipationId: string };
}): SubmissionRow {
  const { rng, userId, problemId, testcases, verdict, createdAt } = args;
  const language = args.language ?? rng.pick(LANGS);
  const { detail, score, runtimeMs, memoryKb } = buildVerdictDetail({
    verdict,
    language,
    testcases,
    rng,
  });

  const row: SubmissionRow = {
    userId,
    problemId,
    language,
    sourceCode: sampleSource(language, verdict),
    status: statusFor(verdict),
    score,
    runtimeMs,
    memoryKb,
    verdictDetail: detail as unknown as Prisma.InputJsonValue,
    sampleOnly: args.sampleOnly ?? false,
    createdAt,
  };

  const ctx = args.context ?? { kind: "practice" };
  if (ctx.kind === "assignment") {
    row.courseId = COURSE_ID;
    row.courseAssessmentId = ctx.courseAssessmentId;
  } else if (ctx.kind === "exam") {
    row.courseId = COURSE_ID;
    row.examId = ctx.examId;
  } else if (ctx.kind === "contest") {
    row.contestId = ctx.contestId;
    row.contestParticipationId = ctx.contestParticipationId;
  }

  return row;
}

/**
 * Seed every demo submission context with relative timestamps. Idempotent:
 * wipes the rows it owns (Submission + ContestParticipation) before recreating
 * so a reseed is clean.
 */
export async function seedSubmissions(
  prisma: PrismaClient,
  refs: { student: User; demoStudents: User[] },
): Promise<void> {
  const now = Date.now();
  const { student, demoStudents } = refs;

  // ── Idempotency: drop rows owned by this module ──
  await prisma.submission.deleteMany({});
  await prisma.contestParticipation.deleteMany({});

  // Preload testcases for every problem we touch (real set + case ids).
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

  const rows: SubmissionRow[] = [];

  // ─────────────────────────────────────────────────────────────
  // A. Practice — dense ~90-day activity for the main student plus
  //    lighter activity for the first few demo students.
  // ─────────────────────────────────────────────────────────────
  const mainRng = new SeededRng(0x5eed_0001);
  // Walk back 90 days. Most days have activity; the last few days are
  // guaranteed to have submissions so the streak + heatmap look current.
  for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
    const isRecent = dayOffset <= 4;
    const active = isRecent || mainRng.chance(0.55);
    if (!active) continue;

    const perDay = isRecent ? mainRng.int(2, 4) : mainRng.int(1, 3);
    for (let k = 0; k < perDay; k++) {
      const problemId = mainRng.pick(PUBLIC_PRACTICE_PROBLEMS);
      const verdict = mainRng.pick(PRACTICE_VERDICTS);
      // Spread within the day; clamp the most-recent day to the last hour.
      const within =
        dayOffset === 0
          ? now - mainRng.int(5, 55) * 60 * 1000
          : now - dayOffset * DAY + mainRng.int(8, 22) * HOUR + mainRng.int(0, 59) * 60 * 1000;
      rows.push(
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

  // A few sampleOnly (Run) submissions for the main student in the last week.
  for (let i = 0; i < 4; i++) {
    const problemId = mainRng.pick(PUBLIC_PRACTICE_PROBLEMS);
    rows.push(
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

  // Lighter practice for the first 4 demo students over the last ~40 days.
  demoStudents.slice(0, 4).forEach((s, idx) => {
    const rng = new SeededRng(0x5eed_1000 + idx);
    for (let dayOffset = 40; dayOffset >= 0; dayOffset--) {
      if (!rng.chance(0.35)) continue;
      const problemId = rng.pick(PUBLIC_PRACTICE_PROBLEMS);
      const verdict = rng.pick(PRACTICE_VERDICTS);
      const when = now - dayOffset * DAY + rng.int(9, 21) * HOUR;
      rows.push(
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

  // ─────────────────────────────────────────────────────────────
  // B. Assignments — hw1 (warmup-sum + process-log-parser) and
  //    hw2 (add-two-numbers). Every demo student submits 1-3 times.
  // ─────────────────────────────────────────────────────────────
  const HW1_ID = "hw1-process-trace";
  const HW2_ID = "hw2-signal-handling";
  const HW1_PROBLEMS = ["problem_warmup-sum", "problem_process-log-parser"] as const;
  // hw1 window: opens 2026-03-17, due 2026-03-23, closes 2026-03-25.
  const HW1_OPEN = new Date("2026-03-17T09:00:00.000Z").getTime();
  const HW1_DUE = new Date("2026-03-23T15:00:00.000Z").getTime();
  const HW1_CLOSE = new Date("2026-03-25T15:00:00.000Z").getTime();
  // hw2 window: opens 2026-04-16, closes 2026-04-30.
  const HW2_OPEN = new Date("2026-04-16T09:00:00.000Z").getTime();
  const HW2_CLOSE = new Date("2026-04-30T15:00:00.000Z").getTime();

  // hw2 only allows c/cpp.
  const HW2_LANGS: SeedLanguage[] = ["c", "cpp"];

  // Include the main student in coursework too.
  const courseworkStudents = [student, ...demoStudents];

  courseworkStudents.forEach((s, idx) => {
    const rng = new SeededRng(0x5eed_2000 + idx);

    // hw1 — submit to one or both problems, some after dueAt (late penalty).
    for (const problemId of HW1_PROBLEMS) {
      const attempts = rng.int(1, 3);
      for (let a = 0; a < attempts; a++) {
        const verdict =
          a === attempts - 1 ? pickAssignmentFinal(rng) : pickAssignmentEarly(rng);
        // ~25% of last attempts land after dueAt to exercise the flat penalty.
        const late = a === attempts - 1 && rng.chance(0.25);
        const when = late
          ? HW1_DUE + rng.int(1, Math.floor((HW1_CLOSE - HW1_DUE) / HOUR)) * HOUR
          : HW1_OPEN + rng.int(1, Math.floor((HW1_DUE - HW1_OPEN) / HOUR)) * HOUR;
        rows.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict,
            createdAt: new Date(when),
            context: { kind: "assignment", courseAssessmentId: HW1_ID },
          }),
        );
      }
    }

    // hw2 — add-two-numbers only, c/cpp only.
    const hw2Attempts = rng.int(1, 3);
    for (let a = 0; a < hw2Attempts; a++) {
      const verdict =
        a === hw2Attempts - 1 ? pickAssignmentFinal(rng) : pickAssignmentEarly(rng);
      const when = HW2_OPEN + rng.int(1, Math.floor((HW2_CLOSE - HW2_OPEN) / HOUR)) * HOUR;
      rows.push(
        makeSubmission({
          rng,
          userId: s.id,
          problemId: "problem_add-two-numbers",
          testcases: tc("problem_add-two-numbers"),
          verdict,
          createdAt: new Date(when),
          language: rng.pick(HW2_LANGS),
          context: { kind: "assignment", courseAssessmentId: HW2_ID },
        }),
      );
    }
  });

  // ─────────────────────────────────────────────────────────────
  // C. Exam — midterm (graph-docking / fork-bomb-safeguard /
  //    memory-leak-forensics) within the 2026-04-18 09:00-11:00 window.
  // ─────────────────────────────────────────────────────────────
  const EXAM_ID = "exam_midterm-systems-lab";
  const EXAM_PROBLEMS = [
    "problem_graph-docking",
    "problem_fork-bomb-safeguard",
    "problem_memory-leak-forensics",
  ] as const;
  const EXAM_START = new Date("2026-04-18T09:00:00.000Z").getTime();
  const EXAM_END = new Date("2026-04-18T11:00:00.000Z").getTime();
  const EXAM_LANGS: SeedLanguage[] = ["c", "cpp"];

  // Exam participants: the main student + first 6 demo students.
  const examStudents = [student, ...demoStudents.slice(0, 6)];
  examStudents.forEach((s, idx) => {
    const rng = new SeededRng(0x5eed_3000 + idx);
    // Each student attempts a deterministic subset of problems.
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
        rows.push(
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

  // Persist all non-contest submissions in one batch.
  await prisma.submission.createMany({ data: rows });

  // ─────────────────────────────────────────────────────────────
  // D. Contests — spring-qualifier (past, frozen board) and the live
  //    round. ContestParticipation per student; submissions linked via
  //    contestParticipationId. Redis scoreboard populated per participant.
  // ─────────────────────────────────────────────────────────────
  await seedContestSubmissions(prisma, {
    contestId: "spring-qualifier-2026",
    problems: ["problem_warmup-sum", "problem_graph-docking"],
    students: [student, ...demoStudents.slice(0, 8)],
    startsAt: new Date("2026-03-15T14:00:00+08:00"),
    endsAt: new Date("2026-03-15T18:00:00+08:00"),
    // Past contest: submissions land inside the real window.
    submissionTimeFor: (rng) => {
      const start = new Date("2026-03-15T14:00:00+08:00").getTime();
      const end = new Date("2026-03-15T18:00:00+08:00").getTime();
      return start + rng.int(1, Math.floor((end - start) / (60 * 1000)) - 1) * 60 * 1000;
    },
    rngBase: 0x5eed_4000,
    tc,
  });

  await seedContestSubmissions(prisma, {
    contestId: "contest_demo_live",
    problems: ["problem_warmup-sum", "problem_add-two-numbers"],
    students: [student, ...demoStudents.slice(0, 6)],
    startsAt: new Date(now - HOUR),
    endsAt: new Date(now + 2 * HOUR),
    // Live contest: submissions land within the last hour so it looks active.
    submissionTimeFor: (rng) => now - rng.int(2, 58) * 60 * 1000,
    rngBase: 0x5eed_5000,
    tc,
  });

  console.log(
    `  Submissions: ${rows.length} practice/assignment/exam rows + contest rows for 2 contests`,
  );
}

function pickAssignmentEarly(rng: SeededRng): LongVerdict {
  // Earlier attempts skew toward failures (the student is iterating).
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
  // Final attempts skew toward success / partial.
  return rng.pick(["accepted", "accepted", "accepted", "wrong_answer", "time_limit_exceeded"]);
}

/**
 * Seed one contest: a ContestParticipation per student, contest-context
 * submissions, the persisted participation score/penalty, and the Redis
 * scoreboard (ICPC packed score). Redis writes are guarded so a missing Redis
 * does not fail the seed.
 */
async function seedContestSubmissions(
  prisma: PrismaClient,
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
  const { contestId, problems, students, startsAt, endsAt, submissionTimeFor, rngBase, tc } =
    args;

  for (const [idx, s] of students.entries()) {
    const rng = new SeededRng(rngBase + idx);

    const participation = await prisma.contestParticipation.create({
      data: {
        contestId,
        userId: s.id,
        status: "active",
        startedAt: startsAt,
        score: 0,
        penaltySeconds: 0,
      },
    });

    const rows: Prisma.SubmissionCreateManyInput[] = [];
    let solvedCount = 0;
    let totalPenalty = 0;

    for (const problemId of problems) {
      // Deterministic: roughly 70% of problems get solved.
      const willSolve = rng.chance(0.7);
      const wrongAttempts = willSolve ? rng.int(0, 2) : rng.int(1, 3);

      for (let a = 0; a < wrongAttempts; a++) {
        const verdict = rng.pick<LongVerdict>([
          "wrong_answer",
          "runtime_error",
          "time_limit_exceeded",
        ]);
        rows.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict,
            createdAt: new Date(submissionTimeFor(rng)),
            context: { kind: "contest", contestId, contestParticipationId: participation.id },
          }),
        );
      }

      if (willSolve) {
        const acTime = submissionTimeFor(rng);
        rows.push(
          makeSubmission({
            rng,
            userId: s.id,
            problemId,
            testcases: tc(problemId),
            verdict: "accepted",
            createdAt: new Date(acTime),
            context: { kind: "contest", contestId, contestParticipationId: participation.id },
          }),
        );
        solvedCount++;
        // ICPC penalty = minutes from start to AC + 20 min per wrong attempt.
        const minutesToAc = Math.max(
          0,
          Math.round((acTime - startsAt.getTime()) / (60 * 1000)),
        );
        totalPenalty += minutesToAc * 60 + wrongAttempts * 20 * 60;
      }
    }

    if (rows.length > 0) {
      await prisma.submission.createMany({ data: rows });
    }

    // Persist the participation aggregate (ICPC: score = solved count).
    await prisma.contestParticipation.update({
      where: { id: participation.id },
      data: { score: solvedCount, penaltySeconds: totalPenalty },
    });

    // Push to the Redis scoreboard with the same packed-score formula the
    // domain layer uses. Guarded so a missing Redis only logs a warning.
    try {
      const packedScore = solvedCount * 1e9 - totalPenalty;
      await scoreboard.updateScoreboard(
        contestId,
        participation.id,
        packedScore,
        "icpc",
        scoreboard.scoreboardTtlForEndsAt(endsAt),
      );
    } catch (err) {
      console.warn(
        `  [scoreboard] skipped Redis write for ${contestId}/${participation.id}: ${String(err)}`,
      );
    }
  }
}
