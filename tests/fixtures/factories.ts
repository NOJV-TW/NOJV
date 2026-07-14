import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { entryFileNameFor, submissionVerdicts } from "@nojv/core";
import {
  createStorageClient,
  planSubmissionSources,
  putImmutableText,
  putSubmissionSourcePlan,
  putVerdictDetail,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";
import { PrismaClient, type Prisma } from "../../packages/db/generated/prisma/client";
import { resolveConfiguredDestructiveTestDatabase } from "../setup/destructive-test-database";

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
    feedback: status.replaceAll("_", " "),
    runtimeMs: 0,
    score: status === "accepted" ? 100 : 0,
    verdict: status,
  };
}

const TEST_DB_URL = resolveConfiguredDestructiveTestDatabase().databaseUrl;

const adapter = new PrismaPg({ connectionString: TEST_DB_URL });

export const testPrisma = new PrismaClient({ adapter });

let counter = 0;
function uid() {
  return `test_${String(Date.now())}_${String(++counter)}`;
}

export async function createTestUser(overrides: Partial<Prisma.UserCreateInput> = {}) {
  const id = uid();
  return testPrisma.user.create({
    data: {
      id,
      email: overrides.email ?? `${id}@test.local`,
      name: overrides.name ?? `Test User ${id}`,
      username: overrides.username ?? id,
      platformRole: overrides.platformRole ?? "student",
      ...overrides,
    },
  });
}

type TestProblemOverrides = Partial<Prisma.ProblemUncheckedCreateInput> & {
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
    samples: _samples,
    ...rest
  } = overrides;
  void _defaultTitle;
  void _title;
  void _tags;
  void _samples;

  const status = overrides.status ?? "published";
  // Mirror production: a displayId ("#N") is assigned only when published.
  const displayId =
    status === "published"
      ? ((await testPrisma.problem.aggregate({ _max: { displayId: true } }))._max.displayId ??
          0) + 1
      : null;

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
      samples: overrides.samples ?? [{ input: "1 2", output: "3" }],
      ...rest,
      authorId,
      status,
      displayId,
    },
  });

  await testPrisma.problemStatement.create({
    data: {
      problemId: problem.id,
      bodyMarkdown: "Test problem body",
      inputFormat: "Test input format",
      outputFormat: "Test output format",
    },
  });

  const testcaseSet = await testPrisma.testcaseSet.create({
    data: {
      problemId: problem.id,
      name: "sample",
      weight: 1,
    },
  });

  const testcaseId = randomUUID();
  const testcaseVersion = randomUUID();
  const [inputStorage, outputStorage] = await Promise.all([
    putImmutableText(
      storage(),
      testcaseInputKey(problem.id, testcaseId, testcaseVersion),
      "1 2",
    ),
    putImmutableText(
      storage(),
      testcaseOutputKey(problem.id, testcaseId, testcaseVersion),
      "3",
    ),
  ]);
  await testPrisma.testcase.create({
    data: {
      id: testcaseId,
      testcaseSetId: testcaseSet.id,
      ordinal: 1,
      inputStorage,
      outputStorage,
    },
  });
  await testPrisma.problem.update({
    where: { id: problem.id },
    data: { activeStorageBytes: inputStorage.size + outputStorage.size },
  });

  return problem;
}

export async function createTestProblemWorkspaceFile(
  overrides: Omit<Partial<Prisma.ProblemWorkspaceFileUncheckedCreateInput>, "contentStorage"> & {
    problemId: string;
    content?: string;
  },
) {
  const fileId = randomUUID();
  const contentStorage = await putImmutableText(
    storage(),
    workspaceFileKey(overrides.problemId, fileId, randomUUID()),
    overrides.content ?? "// starter\n",
  );
  const row = await testPrisma.problemWorkspaceFile.create({
    data: {
      id: fileId,
      language: overrides.language ?? "cpp",
      path: overrides.path ?? "main.cpp",
      contentStorage,
      visibility: overrides.visibility ?? "editable",
      orderIndex: overrides.orderIndex ?? 0,
      problemId: overrides.problemId,
    },
  });
  await testPrisma.problem.update({
    where: { id: overrides.problemId },
    data: { activeStorageBytes: { increment: contentStorage.size } },
  });
  return row;
}

export async function createTestContest(
  overrides: Partial<Prisma.ContestUncheckedCreateInput> = {},
) {
  const id = uid();
  return testPrisma.contest.create({
    data: {
      id,
      title: overrides.title ?? `Test Contest ${id}`,
      summary: overrides.summary ?? "A test contest",
      visibility: overrides.visibility ?? "published",
      startsAt: overrides.startsAt ?? new Date("2026-01-01T00:00:00Z"),
      endsAt: overrides.endsAt ?? new Date("2026-12-31T23:59:59Z"),
      ...overrides,
    },
  });
}

export async function createTestExam(
  overrides: Omit<Partial<Prisma.ExamUncheckedCreateInput>, "courseId"> & {
    courseId: string;
  },
) {
  const id = uid();
  return testPrisma.exam.create({
    data: {
      id,
      title: overrides.title ?? `Test Exam ${id}`,
      summary: overrides.summary ?? "A test exam",
      status: overrides.status ?? "published",
      startsAt: overrides.startsAt ?? new Date("2026-01-01T00:00:00Z"),
      endsAt: overrides.endsAt ?? new Date("2026-12-31T23:59:59Z"),
      ...overrides,
    },
  });
}

export async function createTestCourse(
  overrides: Partial<Prisma.CourseUncheckedCreateInput> = {},
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
      ownerId,
    },
  });
}

type CreateTestSubmissionInput = Omit<
  Partial<Prisma.SubmissionUncheckedCreateInput>,
  | "sourceStorage"
  | "verdictDetailStorage"
  | "judgeGeneration"
  | "activeJudgeRunId"
> & {
  sourceCode?: string;
  verdictDetail?: Prisma.InputJsonValue;
};

export async function createTestSubmission(overrides: CreateTestSubmissionInput = {}) {
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
  const verdictDetail: Prisma.InputJsonValue | undefined =
    overrides.verdictDetail ??
    (isTerminalVerdict(status) ? buildDefaultVerdictDetail(status) : undefined);

  const sourceCode = overrides.sourceCode ?? 'print("hello")';
  const sourcePlan = planSubmissionSources(id, randomUUID(), [
    { path: entryFileNameFor(overrides.language ?? "python"), content: sourceCode },
  ]);
  const [sourceStorage, verdictDetailStorage] = await Promise.all([
    putSubmissionSourcePlan(storage(), sourcePlan),
    verdictDetail === undefined
      ? Promise.resolve(null)
      : putVerdictDetail(storage(), id, `fixture-${randomUUID()}`, verdictDetail),
  ]);

  const { sourceCode: _sc, verdictDetail: _vd, userId: _u, problemId: _p, ...rest } = overrides;
  void _sc;
  void _vd;
  void _u;
  void _p;

  const row = await testPrisma.submission.create({
    data: {
      id,
      language: overrides.language ?? "python",
      sourceStorage,
      status,
      ...(verdictDetail !== undefined && verdictDetailStorage !== null
        ? {
            verdictSummary: deriveSummaryForFactory(verdictDetail),
            verdictDetailStorage,
          }
        : {}),
      ...rest,
      userId,
      problemId,
    },
  });

  return row;
}

function deriveSummaryForFactory(detail: Prisma.InputJsonValue): Prisma.InputJsonValue {
  const caseSummary = { ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 };
  if (
    detail &&
    typeof detail === "object" &&
    !Array.isArray(detail) &&
    Array.isArray((detail as { caseResults?: unknown }).caseResults)
  ) {
    for (const c of (detail as { caseResults: { verdict?: string }[] }).caseResults) {
      const v = (c.verdict ?? "").toUpperCase();
      if (v === "AC") caseSummary.ac += 1;
      else if (v === "WA") caseSummary.wa += 1;
      else if (v === "TLE") caseSummary.tle += 1;
      else if (v === "MLE") caseSummary.mle += 1;
      else if (v === "RE") caseSummary.re += 1;
      else caseSummary.other += 1;
    }
  }
  return { caseSummary };
}
