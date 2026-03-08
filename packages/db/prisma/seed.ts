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

async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

async function main() {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  // --- Users ---
  const admin = await prisma.user.upsert({
    where: { handle: "admin" },
    update: { passwordHash },
    create: {
      id: "usr_admin",
      email: "admin@nojv.local",
      handle: "admin",
      displayName: "Admin",
      passwordHash,
      platformRole: "admin"
    }
  });

  const teacherAmelia = await prisma.user.upsert({
    where: { handle: "teacher_amelia" },
    update: { passwordHash },
    create: {
      id: "usr_teacher_amelia",
      email: "amelia.chen@nojv.local",
      handle: "teacher_amelia",
      displayName: "Amelia Chen",
      passwordHash,
      platformRole: "teacher"
    }
  });

  const teacherLin = await prisma.user.upsert({
    where: { handle: "teacher_lin" },
    update: { passwordHash },
    create: {
      id: "usr_teacher_lin",
      email: "lin.carter@nojv.local",
      handle: "teacher_lin",
      displayName: "Lin Carter",
      passwordHash,
      platformRole: "teacher"
    }
  });

  const taRen = await prisma.user.upsert({
    where: { handle: "ta_ren" },
    update: { passwordHash },
    create: {
      id: "usr_ta_ren",
      email: "ren.wu@nojv.local",
      handle: "ta_ren",
      displayName: "Ren Wu",
      passwordHash,
      platformRole: "ta"
    }
  });

  const stuAlice = await prisma.user.upsert({
    where: { handle: "stu_alice" },
    update: { passwordHash },
    create: {
      id: "usr_student_alice",
      email: "alice.huang@nojv.local",
      handle: "stu_alice",
      displayName: "Alice Huang",
      passwordHash,
      platformRole: "student"
    }
  });

  const stuBob = await prisma.user.upsert({
    where: { handle: "stu_bob" },
    update: { passwordHash },
    create: {
      id: "usr_student_bob",
      email: "bob.lin@nojv.local",
      handle: "stu_bob",
      displayName: "Bob Lin",
      passwordHash,
      platformRole: "student"
    }
  });

  const stuMaya = await prisma.user.upsert({
    where: { handle: "stu_maya" },
    update: { passwordHash },
    create: {
      id: "usr_student_maya",
      email: "maya.su@nojv.local",
      handle: "stu_maya",
      displayName: "Maya Su",
      passwordHash,
      platformRole: "student"
    }
  });

  console.log(`Seeded ${7} users (password: ${DEFAULT_PASSWORD})`);

  // --- Problems ---
  const warmupSum = await prisma.problem.upsert({
    where: { slug: "warmup-sum" },
    update: {},
    create: {
      id: "problem_warmup-sum",
      slug: "warmup-sum",
      defaultTitle: "Warmup Sum",
      summary:
        "The sandbox-backed testcase judge uses this task to exercise the editor, queue, and submission lifecycle.",
      difficulty: "easy",
      visibility: "public",
      authorId: teacherAmelia.id,
      timeLimitMs: 1000,
      memoryLimitMb: 256
    }
  });

  const graphDocking = await prisma.problem.upsert({
    where: { slug: "graph-docking" },
    update: {},
    create: {
      id: "problem_graph-docking",
      slug: "graph-docking",
      defaultTitle: "Graph Docking",
      summary: "A medium problem used to show richer catalog metadata on the problem page.",
      difficulty: "medium",
      visibility: "public",
      authorId: teacherAmelia.id,
      timeLimitMs: 2000,
      memoryLimitMb: 256
    }
  });

  const distributedLabyrinth = await prisma.problem.upsert({
    where: { slug: "distributed-labyrinth" },
    update: {},
    create: {
      id: "problem_distributed-labyrinth",
      slug: "distributed-labyrinth",
      defaultTitle: "Distributed Labyrinth",
      summary:
        "A hard graph problem that showcases the catalog's ability to carry richer editorial metadata and higher-difficulty workloads.",
      difficulty: "hard",
      visibility: "public",
      authorId: teacherAmelia.id,
      timeLimitMs: 3000,
      memoryLimitMb: 512
    }
  });

  const processLogParser = await prisma.problem.upsert({
    where: { slug: "process-log-parser" },
    update: {},
    create: {
      id: "problem_process-log-parser",
      slug: "process-log-parser",
      defaultTitle: "Process Log Parser",
      summary:
        "A private course problem for assignments where the public catalog should not reveal the prompt.",
      difficulty: "medium",
      visibility: "private",
      authorId: teacherAmelia.id,
      timeLimitMs: 1000,
      memoryLimitMb: 256
    }
  });

  const forkBombSafeguard = await prisma.problem.upsert({
    where: { slug: "fork-bomb-safeguard" },
    update: {},
    create: {
      id: "problem_fork-bomb-safeguard",
      slug: "fork-bomb-safeguard",
      defaultTitle: "Fork Bomb Safeguard",
      summary: "A private exam problem that should only surface inside a course assessment.",
      difficulty: "hard",
      visibility: "private",
      authorId: teacherAmelia.id,
      timeLimitMs: 2000,
      memoryLimitMb: 256
    }
  });

  console.log(`Seeded ${5} problems`);

  // --- Problem statements (zh-TW) ---
  const statements = [
    {
      problemId: warmupSum.id,
      title: "Warmup Sum",
      bodyMarkdown:
        "Implement the classic warmup judge task. Read exactly two integers from standard input and print their sum followed by a newline."
    },
    {
      problemId: graphDocking.id,
      title: "Graph Docking",
      bodyMarkdown:
        "Maintain the next available dock for each incoming ship. The hidden judge favors DSU or greedy path compression approaches."
    },
    {
      problemId: distributedLabyrinth.id,
      title: "Distributed Labyrinth",
      bodyMarkdown:
        "Coordinate multiple agents across layered corridors while preserving shortest-path guarantees. Efficient state compression and shortest-path reasoning are both required once the maze begins to branch."
    },
    {
      problemId: processLogParser.id,
      title: "Process Log Parser",
      bodyMarkdown:
        "Parse an operating-system process trace and emit a normalized lifecycle log. This private problem is meant for course-only usage."
    },
    {
      problemId: forkBombSafeguard.id,
      title: "Fork Bomb Safeguard",
      bodyMarkdown:
        "Compute the minimum cost isolation strategy for a process tree under burst constraints. This problem stays private to the course exam."
    }
  ];

  for (const stmt of statements) {
    await prisma.problemStatementI18n.upsert({
      where: { problemId_locale: { problemId: stmt.problemId, locale: "zh-TW" } },
      update: { bodyMarkdown: stmt.bodyMarkdown, title: stmt.title },
      create: { ...stmt, locale: "zh-TW" }
    });
  }

  console.log(`Seeded ${statements.length} problem statements`);

  // --- Testcase sets for warmup-sum (the only problem with a working judge) ---
  const sampleSet = await prisma.testcaseSet.upsert({
    where: { problemId_name: { problemId: warmupSum.id, name: "samples" } },
    update: {},
    create: {
      problemId: warmupSum.id,
      name: "samples",
      isHidden: false,
      weight: 0
    }
  });

  const sampleCases = [{ stdin: "2 5\n", expectedStdout: "7\n" }];
  for (const [i, tc] of sampleCases.entries()) {
    await prisma.testcase.upsert({
      where: { testcaseSetId_ordinal: { testcaseSetId: sampleSet.id, ordinal: i + 1 } },
      update: { stdin: tc.stdin, expectedStdout: tc.expectedStdout },
      create: { testcaseSetId: sampleSet.id, ordinal: i + 1, ...tc }
    });
  }

  const mainSet = await prisma.testcaseSet.upsert({
    where: { problemId_name: { problemId: warmupSum.id, name: "main" } },
    update: {},
    create: {
      problemId: warmupSum.id,
      name: "main",
      isHidden: true,
      weight: 1
    }
  });

  const mainCases = [
    { stdin: "0 0\n", expectedStdout: "0\n" },
    { stdin: "1 1\n", expectedStdout: "2\n" },
    { stdin: "-3 7\n", expectedStdout: "4\n" },
    { stdin: "1000000 2000000\n", expectedStdout: "3000000\n" },
    { stdin: "-1000000 1000000\n", expectedStdout: "0\n" }
  ];
  for (const [i, tc] of mainCases.entries()) {
    await prisma.testcase.upsert({
      where: { testcaseSetId_ordinal: { testcaseSetId: mainSet.id, ordinal: i + 1 } },
      update: { stdin: tc.stdin, expectedStdout: tc.expectedStdout },
      create: { testcaseSetId: mainSet.id, ordinal: i + 1, ...tc }
    });
  }

  console.log(`Seeded testcases for warmup-sum (${sampleCases.length} sample, ${mainCases.length} hidden)`);

  // --- Contests ---
  const springQualifier = await prisma.contest.upsert({
    where: { slug: "spring-qualifier-2026" },
    update: {},
    create: {
      id: "contest_spring-qualifier-2026",
      slug: "spring-qualifier-2026",
      title: "Spring Qualifier 2026",
      summary:
        "Qualifier contest with a frozen board in the final hour.",
      startsAt: new Date("2026-03-15T06:00:00.000Z"),
      endsAt: new Date("2026-03-15T10:00:00.000Z"),
      frozenBoard: true,
      visibility: "published"
    }
  });

  await prisma.contestProblem.upsert({
    where: { contestId_ordinal: { contestId: springQualifier.id, ordinal: 1 } },
    update: {},
    create: { contestId: springQualifier.id, problemId: warmupSum.id, ordinal: 1, points: 100 }
  });
  await prisma.contestProblem.upsert({
    where: { contestId_ordinal: { contestId: springQualifier.id, ordinal: 2 } },
    update: {},
    create: {
      contestId: springQualifier.id,
      problemId: graphDocking.id,
      ordinal: 2,
      points: 300
    }
  });

  const systemsLabMidterm = await prisma.contest.upsert({
    where: { slug: "systems-lab-midterm" },
    update: {},
    create: {
      id: "contest_systems-lab-midterm",
      slug: "systems-lab-midterm",
      title: "Systems Lab Midterm",
      summary:
        "Assignment-flavored contest where participants keep an isolated workspace but still submit through a contest-specific scoring surface.",
      startsAt: new Date("2026-03-22T10:00:00.000Z"),
      endsAt: new Date("2026-03-22T13:00:00.000Z"),
      frozenBoard: false,
      visibility: "published"
    }
  });

  await prisma.contestProblem.upsert({
    where: { contestId_ordinal: { contestId: systemsLabMidterm.id, ordinal: 1 } },
    update: {},
    create: {
      contestId: systemsLabMidterm.id,
      problemId: warmupSum.id,
      ordinal: 1,
      points: 100
    }
  });
  await prisma.contestProblem.upsert({
    where: { contestId_ordinal: { contestId: systemsLabMidterm.id, ordinal: 2 } },
    update: {},
    create: {
      contestId: systemsLabMidterm.id,
      problemId: distributedLabyrinth.id,
      ordinal: 2,
      points: 500
    }
  });

  console.log(`Seeded ${2} contests`);

  // --- Courses ---
  const osLab = await prisma.course.upsert({
    where: { slug: "os-lab-spring-2026" },
    update: {},
    create: {
      slug: "os-lab-spring-2026",
      title: "Operating Systems Lab",
      description:
        "A course-managed OJ space for systems programming. Teachers own the course, TAs manage operations, and students join by QR code, join code, or manual enrollment.",
      locale: "zh-TW",
      visibility: "invite_only",
      ownerId: teacherAmelia.id
    }
  });

  const algoStudio = await prisma.course.upsert({
    where: { slug: "algorithm-studio-2026" },
    update: {},
    create: {
      slug: "algorithm-studio-2026",
      title: "Algorithm Studio",
      description:
        "An algorithm design studio where the teacher curates a mixed shelf of public catalog problems and course-private derivatives.",
      locale: "en",
      visibility: "invite_only",
      ownerId: teacherLin.id
    }
  });

  console.log(`Seeded ${2} courses`);

  // --- Course memberships ---
  const memberships = [
    { courseId: osLab.id, userId: teacherAmelia.id, role: "teacher" as const, joinedVia: "manual_invite" as const, addedByUserId: teacherAmelia.id },
    { courseId: osLab.id, userId: taRen.id, role: "ta" as const, joinedVia: "manual_invite" as const, addedByUserId: teacherAmelia.id },
    { courseId: osLab.id, userId: stuAlice.id, role: "student" as const, joinedVia: "join_code" as const, addedByUserId: teacherAmelia.id },
    { courseId: osLab.id, userId: stuBob.id, role: "student" as const, joinedVia: "qr_code" as const, addedByUserId: teacherAmelia.id },
    { courseId: algoStudio.id, userId: teacherLin.id, role: "teacher" as const, joinedVia: "manual_invite" as const, addedByUserId: teacherLin.id },
    { courseId: algoStudio.id, userId: stuMaya.id, role: "student" as const, joinedVia: "qr_code" as const, addedByUserId: teacherLin.id }
  ];

  for (const m of memberships) {
    await prisma.courseMembership.upsert({
      where: { courseId_userId: { courseId: m.courseId, userId: m.userId } },
      update: {},
      create: { ...m, status: "active", joinedAt: new Date() }
    });
  }

  console.log(`Seeded ${memberships.length} course memberships`);

  // --- Course join tokens ---
  const joinTokens = [
    { courseId: osLab.id, method: "qr_code" as const, token: "oslab-qr-2026", label: "Course QR", createdByUserId: teacherAmelia.id },
    { courseId: osLab.id, method: "join_code" as const, token: "OSLAB2026", label: "Course code", createdByUserId: teacherAmelia.id },
    { courseId: algoStudio.id, method: "qr_code" as const, token: "algo-studio-qr", label: "Studio QR", createdByUserId: teacherLin.id },
    { courseId: algoStudio.id, method: "join_code" as const, token: "ALGOSTUDIO", label: "Studio code", createdByUserId: teacherLin.id }
  ];

  for (const jt of joinTokens) {
    await prisma.courseJoinToken.upsert({
      where: { token: jt.token },
      update: {},
      create: jt
    });
  }

  console.log(`Seeded ${joinTokens.length} course join tokens`);

  // --- Course problems ---
  const courseProblems = [
    { courseId: osLab.id, problems: [warmupSum, graphDocking, processLogParser, forkBombSafeguard], addedByUserId: teacherAmelia.id },
    { courseId: algoStudio.id, problems: [warmupSum, distributedLabyrinth], addedByUserId: teacherLin.id }
  ];

  let courseProblemCount = 0;
  for (const cp of courseProblems) {
    for (const problem of cp.problems) {
      await prisma.courseProblem.upsert({
        where: { courseId_problemId: { courseId: cp.courseId, problemId: problem.id } },
        update: {},
        create: { courseId: cp.courseId, problemId: problem.id, addedByUserId: cp.addedByUserId }
      });
      courseProblemCount++;
    }
  }

  console.log(`Seeded ${courseProblemCount} course-problem links`);

  // --- Course assessments ---
  const hw1 = await prisma.courseAssessment.upsert({
    where: { courseId_slug: { courseId: osLab.id, slug: "hw1-process-trace" } },
    update: {},
    create: {
      courseId: osLab.id,
      slug: "hw1-process-trace",
      title: "Homework 1: Process Trace",
      summary: "Coursework-oriented assignment with a visible deadline and a private systems problem.",
      type: "assignment",
      status: "published",
      scoreboardMode: "hidden",
      opensAt: new Date("2026-03-17T09:00:00.000Z"),
      dueAt: new Date("2026-03-23T15:00:00.000Z"),
      closesAt: new Date("2026-03-25T15:00:00.000Z"),
      createdByUserId: teacherAmelia.id
    }
  });

  const midterm = await prisma.courseAssessment.upsert({
    where: { courseId_slug: { courseId: osLab.id, slug: "midterm-systems-lab" } },
    update: {},
    create: {
      courseId: osLab.id,
      slug: "midterm-systems-lab",
      title: "Midterm Systems Lab",
      summary: "Exam-style assessment with contest-grade pacing, live ranking, and tighter shell policy.",
      type: "exam",
      status: "published",
      scoreboardMode: "live",
      opensAt: new Date("2026-04-02T09:00:00.000Z"),
      dueAt: new Date("2026-04-02T12:00:00.000Z"),
      closesAt: new Date("2026-04-02T12:00:00.000Z"),
      createdByUserId: teacherAmelia.id
    }
  });

  const hw2 = await prisma.courseAssessment.upsert({
    where: { courseId_slug: { courseId: algoStudio.id, slug: "hw2-graph-state" } },
    update: {},
    create: {
      courseId: algoStudio.id,
      slug: "hw2-graph-state",
      title: "Homework 2: Graph State Compression",
      summary: "Algorithm homework with a longer open window and no live ranking pressure.",
      type: "assignment",
      status: "published",
      scoreboardMode: "hidden",
      opensAt: new Date("2026-04-01T09:00:00.000Z"),
      dueAt: new Date("2026-04-10T15:00:00.000Z"),
      closesAt: new Date("2026-04-12T15:00:00.000Z"),
      createdByUserId: teacherLin.id
    }
  });

  // --- Assessment problems ---
  const assessmentProblems = [
    { assessmentId: hw1.id, problemId: warmupSum.id, ordinal: 1 },
    { assessmentId: hw1.id, problemId: processLogParser.id, ordinal: 2 },
    { assessmentId: midterm.id, problemId: graphDocking.id, ordinal: 1 },
    { assessmentId: midterm.id, problemId: forkBombSafeguard.id, ordinal: 2 },
    { assessmentId: hw2.id, problemId: warmupSum.id, ordinal: 1 },
    { assessmentId: hw2.id, problemId: distributedLabyrinth.id, ordinal: 2 }
  ];

  for (const ap of assessmentProblems) {
    await prisma.courseAssessmentProblem.upsert({
      where: { assessmentId_ordinal: { assessmentId: ap.assessmentId, ordinal: ap.ordinal } },
      update: {},
      create: { ...ap, points: 100 }
    });
  }

  console.log(`Seeded ${3} assessments with ${assessmentProblems.length} problems`);

  console.log("\nSeed complete! Demo accounts:");
  console.log("  admin       / password123  (admin)");
  console.log("  teacher_amelia / password123  (teacher)");
  console.log("  teacher_lin    / password123  (teacher)");
  console.log("  ta_ren         / password123  (ta)");
  console.log("  stu_alice      / password123  (student)");
  console.log("  stu_bob        / password123  (student)");
  console.log("  stu_maya       / password123  (student)");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
