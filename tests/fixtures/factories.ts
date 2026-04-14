// tests/fixtures/factories.ts
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { submissionVerdicts } from "@nojv/core";
import {
  createStorageClient,
  putText,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey
} from "@nojv/storage";
import { PrismaClient, type Prisma } from "../../packages/db/generated/prisma/client";

// Lazy S3 client — one instance per process so parallel factories share
// the same underlying HTTP agent pool.
let cachedStorage: ReturnType<typeof createStorageClient> | null = null;
function storage() {
  cachedStorage ??= createStorageClient();
  return cachedStorage;
}

type SubmissionVerdict = (typeof submissionVerdicts)[number];

function isTerminalVerdict(status: string): status is SubmissionVerdict {
  return (submissionVerdicts as readonly string[]).includes(status);
}

function buildDefaultVerdictDetail(status: SubmissionVerdict): Prisma.InputJsonValue {
  return {
    accepted: status === "accepted",
    feedback: status.replace(/_/g, " "),
    runtimeMs: 0,
    score: status === "accepted" ? 100 : 0,
    verdict: status
  };
}

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
      ...overrides
    }
  });
}

// --- Problem ---
type TestProblemOverrides = Partial<Prisma.ProblemUncheckedCreateInput> & {
  /** Convenience alias accepted by tests that still pass `defaultTitle`. */
  defaultTitle?: string;
};

export async function createTestProblem(overrides: TestProblemOverrides = {}) {
  const id = uid();
  let authorId = overrides.authorId;
  if (!authorId) {
    const author = await createTestUser({ platformRole: "teacher" });
    authorId = author.id;
  }

  const title = overrides.title ?? overrides.defaultTitle ?? `Test Problem ${id}`;
  const extraTags = Array.isArray(overrides.tags) ? overrides.tags : [];

  const {
    defaultTitle: _defaultTitle,
    title: _title,
    tags: _tags,
    slug: _slug,
    samples: _samples,
    ...rest
  } = overrides;
  void _defaultTitle;
  void _title;
  void _tags;
  void _slug;

  const problem = await testPrisma.problem.create({
    data: {
      id,
      title,
      tags: extraTags,
      difficulty: overrides.difficulty ?? "easy",
      type: overrides.type ?? "full_source",
      timeLimitMs: overrides.timeLimitMs ?? 1000,
      memoryLimitMb: overrides.memoryLimitMb ?? 256,
      visibility: overrides.visibility ?? "public",
      // Default to published so tests that assert list-visibility Just Work.
      // Production-facing create flows override this with a draft default.
      status: overrides.status ?? "published",
      samples: overrides.samples ?? [{ input: "1 2", output: "3" }],
      ...rest,
      authorId
    }
  });

  // Create a default statement
  await testPrisma.problemStatementI18n.create({
    data: {
      problemId: problem.id,
      locale: "en",
      title: problem.title,
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
      weight: 1
    }
  });

  const testcaseId = randomUUID();
  const inputKey = testcaseInputKey(problem.id, testcaseId);
  const outputKey = testcaseOutputKey(problem.id, testcaseId);
  await Promise.all([putText(storage(), inputKey, "1 2"), putText(storage(), outputKey, "3")]);
  await testPrisma.testcase.create({
    data: {
      id: testcaseId,
      testcaseSetId: testcaseSet.id,
      ordinal: 1,
      inputKey,
      outputKey
    }
  });

  return problem;
}

// --- Problem workspace file ---
// Allows a test to attach editable/readonly/hidden files to an existing
// problem. No existing test needs this by default; callers opt in.
export async function createTestProblemWorkspaceFile(
  overrides: Omit<Partial<Prisma.ProblemWorkspaceFileUncheckedCreateInput>, "contentKey"> & {
    problemId: string;
    content?: string;
  }
) {
  const fileId = randomUUID();
  const contentKey = workspaceFileKey(overrides.problemId, fileId);
  await putText(storage(), contentKey, overrides.content ?? "// starter\n");
  return testPrisma.problemWorkspaceFile.create({
    data: {
      id: fileId,
      language: overrides.language ?? "cpp",
      path: overrides.path ?? "main.cpp",
      contentKey,
      visibility: overrides.visibility ?? "editable",
      orderIndex: overrides.orderIndex ?? 0,
      problemId: overrides.problemId
    }
  });
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
      title: overrides.title ?? `Test Course ${id}`,
      description: overrides.description ?? "A test course",
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

  const status = overrides.status ?? "accepted";
  // Terminal statuses always carry a verdictDetail in production — the judge
  // pipeline writes them atomically. Integration tests that only care about
  // filtering/ordering fall through this default so `listProblemSubmissions`
  // (which `.parse()`s verdictDetail) doesn't blow up on a missing JSONB.
  const defaultVerdictDetail = isTerminalVerdict(status)
    ? buildDefaultVerdictDetail(status)
    : undefined;

  return testPrisma.submission.create({
    data: {
      id,
      language: overrides.language ?? "python",
      sourceCode: overrides.sourceCode ?? 'print("hello")',
      status,
      ...(defaultVerdictDetail !== undefined ? { verdictDetail: defaultVerdictDetail } : {}),
      ...overrides,
      userId,
      problemId
    }
  });
}
