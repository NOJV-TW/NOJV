// tests/fixtures/factories.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../packages/db/generated/prisma/client";

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/nojv_test";

const adapter = new PrismaPg({ connectionString: TEST_DB_URL });

export const testPrisma = new PrismaClient({ adapter });

let counter = 0;
function uid() {
  return `test_${Date.now()}_${++counter}`;
}

// --- User ---
export async function createTestUser(overrides: Partial<Prisma.UserCreateInput> = {}) {
  const id = uid();
  return testPrisma.user.create({
    data: {
      id,
      email: overrides.email ?? `${id}@test.local`,
      name: overrides.name ?? `Test User ${id}`,
      username: overrides.username ?? id,
      platformRole: overrides.platformRole ?? "student",
      locale: "en",
      ...overrides
    }
  });
}

// --- Problem ---
export async function createTestProblem(
  overrides: Partial<Prisma.ProblemUncheckedCreateInput> = {}
) {
  const id = uid();
  let authorId = overrides.authorId;
  if (!authorId) {
    const author = await createTestUser({ platformRole: "teacher" });
    authorId = author.id;
  }
  const problem = await testPrisma.problem.create({
    data: {
      id,
      defaultTitle: overrides.defaultTitle ?? `Test Problem ${id}`,
      difficulty: overrides.difficulty ?? "easy",
      summary: overrides.summary ?? "A test problem",
      timeLimitMs: overrides.timeLimitMs ?? 1000,
      memoryLimitMb: overrides.memoryLimitMb ?? 256,
      visibility: overrides.visibility ?? "public",
      ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "slug")),
      authorId
    }
  });

  // Create a default statement
  await testPrisma.problemStatementI18n.create({
    data: {
      problemId: problem.id,
      locale: "en",
      title: problem.defaultTitle,
      bodyMarkdown: "Test problem body",
      inputFormat: "Test input format",
      outputFormat: "Test output format"
    }
  });

  // Create a default testcase set with one testcase
  const testcaseSet = await testPrisma.testcaseSet.create({
    data: {
      problemId: problem.id,
      name: "sample",
      isHidden: false,
      weight: 1
    }
  });

  await testPrisma.testcase.create({
    data: {
      testcaseSetId: testcaseSet.id,
      ordinal: 1,
      stdin: "1 2",
      expectedStdout: "3"
    }
  });

  return problem;
}

// --- Contest ---
export async function createTestContest(
  overrides: Partial<Prisma.ContestUncheckedCreateInput> = {}
) {
  const id = uid();
  return testPrisma.contest.create({
    data: {
      id,
      slug: overrides.slug ?? `test-contest-${id}`,
      title: overrides.title ?? `Test Contest ${id}`,
      summary: overrides.summary ?? "A test contest",
      visibility: overrides.visibility ?? "published",
      startsAt: overrides.startsAt ?? new Date("2026-01-01T00:00:00Z"),
      endsAt: overrides.endsAt ?? new Date("2026-12-31T23:59:59Z"),
      ...overrides
    }
  });
}

// --- Course ---
export async function createTestCourse(
  overrides: Partial<Prisma.CourseUncheckedCreateInput> = {}
) {
  const id = uid();
  let ownerId = overrides.ownerId;
  if (!ownerId) {
    const owner = await createTestUser({ platformRole: "teacher" });
    ownerId = owner.id;
  }

  return testPrisma.course.create({
    data: {
      id,
      slug: overrides.slug ?? `test-course-${id}`,
      title: overrides.title ?? `Test Course ${id}`,
      description: overrides.description ?? "A test course",
      locale: overrides.locale ?? "en",
      visibility: overrides.visibility ?? "listed",
      ...overrides,
      ownerId
    }
  });
}

// --- Submission ---
export async function createTestSubmission(
  overrides: Partial<Prisma.SubmissionUncheckedCreateInput> = {}
) {
  const id = uid();
  let userId = overrides.userId;
  if (!userId) {
    const user = await createTestUser();
    userId = user.id;
  }
  let problemId = overrides.problemId;
  if (!problemId) {
    const problem = await createTestProblem();
    problemId = problem.id;
  }

  return testPrisma.submission.create({
    data: {
      id,
      language: overrides.language ?? "python",
      sourceCode: overrides.sourceCode ?? 'print("hello")',
      status: overrides.status ?? "accepted",
      mode: overrides.mode ?? "practice",
      ...overrides,
      userId,
      problemId
    }
  });
}
