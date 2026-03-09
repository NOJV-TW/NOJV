import bcrypt from "bcryptjs";
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/nojv"
});
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = "password123";

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  // --- Users ---
  const userDefs = [
    { id: "usr_admin", email: "admin@nojv.local", handle: "admin", name: "Admin", platformRole: "admin" as const },
    { id: "usr_teacher_amelia", email: "amelia.chen@nojv.local", handle: "teacher_amelia", name: "Amelia Chen", platformRole: "teacher" as const },
    { id: "usr_teacher_lin", email: "lin.carter@nojv.local", handle: "teacher_lin", name: "Lin Carter", platformRole: "teacher" as const },
    { id: "usr_ta_ren", email: "ren.wu@nojv.local", handle: "ta_ren", name: "Ren Wu", platformRole: "ta" as const },
    { id: "usr_student_alice", email: "alice.huang@nojv.local", handle: "stu_alice", name: "Alice Huang", platformRole: "student" as const },
    { id: "usr_student_bob", email: "bob.lin@nojv.local", handle: "stu_bob", name: "Bob Lin", platformRole: "student" as const },
    { id: "usr_student_maya", email: "maya.su@nojv.local", handle: "stu_maya", name: "Maya Su", platformRole: "student" as const }
  ];

  const users = await Promise.all(
    userDefs.map((u) =>
      prisma.user.upsert({
        where: { handle: u.handle },
        update: {},
        create: u
      })
    )
  );

  // Create credential accounts (BetterAuth stores passwords in the Account table)
  await Promise.all(
    users.map((u) =>
      prisma.account.upsert({
        where: { id: `acct_${u.handle}` },
        update: { password: passwordHash },
        create: {
          id: `acct_${u.handle}`,
          accountId: u.id,
          providerId: "credential",
          userId: u.id,
          password: passwordHash
        }
      })
    )
  );

  const userMap = Object.fromEntries(users.map((u) => [u.handle, u])) as Record<string, (typeof users)[0]>;
  console.log(`Seeded ${users.length} users (password: ${DEFAULT_PASSWORD})`);

  // --- Problems ---
  const problemDefs = [
    { id: "problem_warmup-sum", slug: "warmup-sum", defaultTitle: "Warmup Sum", summary: "The sandbox-backed testcase judge uses this task to exercise the editor, queue, and submission lifecycle.", difficulty: "easy", visibility: "public" as const, timeLimitMs: 1000, memoryLimitMb: 256 },
    { id: "problem_graph-docking", slug: "graph-docking", defaultTitle: "Graph Docking", summary: "A medium problem used to show richer catalog metadata on the problem page.", difficulty: "medium", visibility: "public" as const, timeLimitMs: 2000, memoryLimitMb: 256 },
    { id: "problem_distributed-labyrinth", slug: "distributed-labyrinth", defaultTitle: "Distributed Labyrinth", summary: "A hard graph problem that showcases the catalog's ability to carry richer editorial metadata and higher-difficulty workloads.", difficulty: "hard", visibility: "public" as const, timeLimitMs: 3000, memoryLimitMb: 512 },
    { id: "problem_process-log-parser", slug: "process-log-parser", defaultTitle: "Process Log Parser", summary: "A private course problem for assignments where the public catalog should not reveal the prompt.", difficulty: "medium", visibility: "private" as const, timeLimitMs: 1000, memoryLimitMb: 256 },
    { id: "problem_fork-bomb-safeguard", slug: "fork-bomb-safeguard", defaultTitle: "Fork Bomb Safeguard", summary: "A private exam problem that should only surface inside a course assessment.", difficulty: "hard", visibility: "private" as const, timeLimitMs: 2000, memoryLimitMb: 256 }
  ];

  const problems = await Promise.all(
    problemDefs.map((p) =>
      prisma.problem.upsert({
        where: { slug: p.slug },
        update: {},
        create: { ...p, authorId: userMap.teacher_amelia.id }
      })
    )
  );

  const problemMap = Object.fromEntries(problems.map((p) => [p.slug, p])) as Record<string, (typeof problems)[0]>;
  console.log(`Seeded ${problems.length} problems`);

  // --- Problem statements (zh-TW) ---
  const statementDefs = [
    { slug: "warmup-sum", title: "Warmup Sum", bodyMarkdown: "Implement the classic warmup judge task. Read exactly two integers from standard input and print their sum followed by a newline." },
    { slug: "graph-docking", title: "Graph Docking", bodyMarkdown: "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches." },
    { slug: "distributed-labyrinth", title: "Distributed Labyrinth", bodyMarkdown: "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch." },
    { slug: "process-log-parser", title: "Process Log Parser", bodyMarkdown: "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage." },
    { slug: "fork-bomb-safeguard", title: "Fork Bomb Safeguard", bodyMarkdown: "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam." }
  ];

  await Promise.all(
    statementDefs.map((s) => {
      const problemId = problemMap[s.slug].id;
      return prisma.problemStatementI18n.upsert({
        where: { problemId_locale: { problemId, locale: "zh-TW" } },
        update: { bodyMarkdown: s.bodyMarkdown, title: s.title },
        create: { problemId, locale: "zh-TW", title: s.title, bodyMarkdown: s.bodyMarkdown }
      });
    })
  );

  console.log(`Seeded ${statementDefs.length} problem statements`);

  // --- Testcase sets for warmup-sum ---
  const warmupId = problemMap["warmup-sum"].id;

  const [sampleSet, mainSet] = await Promise.all([
    prisma.testcaseSet.upsert({
      where: { problemId_name: { problemId: warmupId, name: "samples" } },
      update: {},
      create: { problemId: warmupId, name: "samples", isHidden: false, weight: 0 }
    }),
    prisma.testcaseSet.upsert({
      where: { problemId_name: { problemId: warmupId, name: "main" } },
      update: {},
      create: { problemId: warmupId, name: "main", isHidden: true, weight: 1 }
    })
  ]);

  const sampleCases = [{ stdin: "2 5\n", expectedStdout: "7\n" }];
  const mainCases = [
    { stdin: "0 0\n", expectedStdout: "0\n" },
    { stdin: "1 1\n", expectedStdout: "2\n" },
    { stdin: "-3 7\n", expectedStdout: "4\n" },
    { stdin: "1000000 2000000\n", expectedStdout: "3000000\n" },
    { stdin: "-1000000 1000000\n", expectedStdout: "0\n" }
  ];

  const upsertTestcases = (setId: string, cases: typeof sampleCases) =>
    Promise.all(
      cases.map((tc, i) =>
        prisma.testcase.upsert({
          where: { testcaseSetId_ordinal: { testcaseSetId: setId, ordinal: i + 1 } },
          update: { stdin: tc.stdin, expectedStdout: tc.expectedStdout },
          create: { testcaseSetId: setId, ordinal: i + 1, ...tc }
        })
      )
    );

  await Promise.all([
    upsertTestcases(sampleSet.id, sampleCases),
    upsertTestcases(mainSet.id, mainCases)
  ]);

  console.log(`Seeded testcases for warmup-sum (${sampleCases.length} sample, ${mainCases.length} hidden)`);

  // --- Contests ---
  const [springQualifier, systemsLabMidterm] = await Promise.all([
    prisma.contest.upsert({
      where: { slug: "spring-qualifier-2026" },
      update: {},
      create: {
        id: "contest_spring-qualifier-2026", slug: "spring-qualifier-2026",
        title: "Spring Qualifier 2026",
        summary: "Qualifier contest with a frozen board in the final hour.",
        startsAt: new Date("2026-03-15T06:00:00.000Z"), endsAt: new Date("2026-03-15T10:00:00.000Z"),
        frozenBoard: true, visibility: "published"
      }
    }),
    prisma.contest.upsert({
      where: { slug: "systems-lab-midterm" },
      update: {},
      create: {
        id: "contest_systems-lab-midterm", slug: "systems-lab-midterm",
        title: "Systems Lab Midterm",
        summary: "Assignment-flavored contest where participants keep an isolated workspace but still submit through a contest-specific scoring surface.",
        startsAt: new Date("2026-03-22T10:00:00.000Z"), endsAt: new Date("2026-03-22T13:00:00.000Z"),
        frozenBoard: false, visibility: "published"
      }
    })
  ]);

  const contestProblemDefs = [
    { contestId: springQualifier.id, problemId: problemMap["warmup-sum"].id, ordinal: 1, points: 100 },
    { contestId: springQualifier.id, problemId: problemMap["graph-docking"].id, ordinal: 2, points: 300 },
    { contestId: systemsLabMidterm.id, problemId: problemMap["warmup-sum"].id, ordinal: 1, points: 100 },
    { contestId: systemsLabMidterm.id, problemId: problemMap["distributed-labyrinth"].id, ordinal: 2, points: 500 }
  ];

  await Promise.all(
    contestProblemDefs.map((cp) =>
      prisma.contestProblem.upsert({
        where: { contestId_ordinal: { contestId: cp.contestId, ordinal: cp.ordinal } },
        update: {},
        create: cp
      })
    )
  );

  console.log(`Seeded 2 contests with ${contestProblemDefs.length} problems`);

  // --- Courses ---
  const [osLab, algoStudio] = await Promise.all([
    prisma.course.upsert({
      where: { slug: "os-lab-spring-2026" },
      update: {},
      create: {
        slug: "os-lab-spring-2026", title: "Operating Systems Lab",
        description: "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students join by QR code, join code, or manual enrollment.",
        locale: "zh-TW", visibility: "invite_only", ownerId: userMap.teacher_amelia.id
      }
    }),
    prisma.course.upsert({
      where: { slug: "algorithm-studio-2026" },
      update: {},
      create: {
        slug: "algorithm-studio-2026", title: "Algorithm Studio",
        description: "An algorithm design studio where the teacher curates a mixed shelf of public catalog problems and course-private derivatives.",
        locale: "en", visibility: "invite_only", ownerId: userMap.teacher_lin.id
      }
    })
  ]);

  console.log("Seeded 2 courses");

  // --- Course memberships, join tokens, and course-problem links (all depend on courses) ---
  const membershipDefs = [
    { courseId: osLab.id, userId: userMap.teacher_amelia.id, role: "teacher" as const, joinedVia: "manual_invite" as const, addedByUserId: userMap.teacher_amelia.id },
    { courseId: osLab.id, userId: userMap.ta_ren.id, role: "ta" as const, joinedVia: "manual_invite" as const, addedByUserId: userMap.teacher_amelia.id },
    { courseId: osLab.id, userId: userMap.stu_alice.id, role: "student" as const, joinedVia: "join_code" as const, addedByUserId: userMap.teacher_amelia.id },
    { courseId: osLab.id, userId: userMap.stu_bob.id, role: "student" as const, joinedVia: "qr_code" as const, addedByUserId: userMap.teacher_amelia.id },
    { courseId: algoStudio.id, userId: userMap.teacher_lin.id, role: "teacher" as const, joinedVia: "manual_invite" as const, addedByUserId: userMap.teacher_lin.id },
    { courseId: algoStudio.id, userId: userMap.stu_maya.id, role: "student" as const, joinedVia: "qr_code" as const, addedByUserId: userMap.teacher_lin.id }
  ];

  const joinTokenDefs = [
    { courseId: osLab.id, method: "qr_code" as const, token: "oslab-qr-2026", label: "Course QR", createdByUserId: userMap.teacher_amelia.id },
    { courseId: osLab.id, method: "join_code" as const, token: "OSLAB2026", label: "Course code", createdByUserId: userMap.teacher_amelia.id },
    { courseId: algoStudio.id, method: "qr_code" as const, token: "algo-studio-qr", label: "Studio QR", createdByUserId: userMap.teacher_lin.id },
    { courseId: algoStudio.id, method: "join_code" as const, token: "ALGOSTUDIO", label: "Studio code", createdByUserId: userMap.teacher_lin.id }
  ];

  const courseProblemLinks = [
    ...[warmupId, problemMap["graph-docking"].id, problemMap["process-log-parser"].id, problemMap["fork-bomb-safeguard"].id]
      .map((pid) => ({ courseId: osLab.id, problemId: pid, addedByUserId: userMap.teacher_amelia.id })),
    ...[warmupId, problemMap["distributed-labyrinth"].id]
      .map((pid) => ({ courseId: algoStudio.id, problemId: pid, addedByUserId: userMap.teacher_lin.id }))
  ];

  await Promise.all([
    ...membershipDefs.map((m) =>
      prisma.courseMembership.upsert({
        where: { courseId_userId: { courseId: m.courseId, userId: m.userId } },
        update: {},
        create: { ...m, status: "active", joinedAt: new Date() }
      })
    ),
    ...joinTokenDefs.map((jt) =>
      prisma.courseJoinToken.upsert({
        where: { token: jt.token },
        update: {},
        create: jt
      })
    ),
    ...courseProblemLinks.map((cp) =>
      prisma.courseProblem.upsert({
        where: { courseId_problemId: { courseId: cp.courseId, problemId: cp.problemId } },
        update: {},
        create: cp
      })
    )
  ]);

  console.log(`Seeded ${membershipDefs.length} memberships, ${joinTokenDefs.length} join tokens, ${courseProblemLinks.length} course-problem links`);

  // --- Course assessments ---
  const [hw1, midterm, hw2] = await Promise.all([
    prisma.courseAssessment.upsert({
      where: { courseId_slug: { courseId: osLab.id, slug: "hw1-process-trace" } },
      update: {},
      create: {
        courseId: osLab.id, slug: "hw1-process-trace", title: "Homework 1: Process Trace",
        summary: "Coursework-oriented assignment with a visible deadline and a private systems problem.",
        type: "assignment", status: "published", scoreboardMode: "hidden",
        opensAt: new Date("2026-03-17T09:00:00.000Z"), dueAt: new Date("2026-03-23T15:00:00.000Z"), closesAt: new Date("2026-03-25T15:00:00.000Z"),
        createdByUserId: userMap.teacher_amelia.id
      }
    }),
    prisma.courseAssessment.upsert({
      where: { courseId_slug: { courseId: osLab.id, slug: "midterm-systems-lab" } },
      update: {},
      create: {
        courseId: osLab.id, slug: "midterm-systems-lab", title: "Midterm Systems Lab",
        summary: "Exam-style assessment with contest-grade pacing, live ranking, and tighter shell policy.",
        type: "exam", status: "published", scoreboardMode: "live",
        opensAt: new Date("2026-04-02T09:00:00.000Z"), dueAt: new Date("2026-04-02T12:00:00.000Z"), closesAt: new Date("2026-04-02T12:00:00.000Z"),
        createdByUserId: userMap.teacher_amelia.id
      }
    }),
    prisma.courseAssessment.upsert({
      where: { courseId_slug: { courseId: algoStudio.id, slug: "hw2-graph-state" } },
      update: {},
      create: {
        courseId: algoStudio.id, slug: "hw2-graph-state", title: "Homework 2: Graph State Compression",
        summary: "Algorithm homework with a longer open window and no live ranking pressure.",
        type: "assignment", status: "published", scoreboardMode: "hidden",
        opensAt: new Date("2026-04-01T09:00:00.000Z"), dueAt: new Date("2026-04-10T15:00:00.000Z"), closesAt: new Date("2026-04-12T15:00:00.000Z"),
        createdByUserId: userMap.teacher_lin.id
      }
    })
  ]);

  // --- Assessment problems ---
  const assessmentProblemDefs = [
    { assessmentId: hw1.id, problemId: warmupId, ordinal: 1 },
    { assessmentId: hw1.id, problemId: problemMap["process-log-parser"].id, ordinal: 2 },
    { assessmentId: midterm.id, problemId: problemMap["graph-docking"].id, ordinal: 1 },
    { assessmentId: midterm.id, problemId: problemMap["fork-bomb-safeguard"].id, ordinal: 2 },
    { assessmentId: hw2.id, problemId: warmupId, ordinal: 1 },
    { assessmentId: hw2.id, problemId: problemMap["distributed-labyrinth"].id, ordinal: 2 }
  ];

  await Promise.all(
    assessmentProblemDefs.map((ap) =>
      prisma.courseAssessmentProblem.upsert({
        where: { assessmentId_ordinal: { assessmentId: ap.assessmentId, ordinal: ap.ordinal } },
        update: {},
        create: { ...ap, points: 100 }
      })
    )
  );

  console.log(`Seeded 3 assessments with ${assessmentProblemDefs.length} problems`);

  console.log("\nSeed complete! Demo accounts:");
  for (const u of userDefs) {
    console.log(`  ${u.handle.padEnd(16)} / ${DEFAULT_PASSWORD}  (${u.platformRole})`);
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
