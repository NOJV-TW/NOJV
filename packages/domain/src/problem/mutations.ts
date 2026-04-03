import {
  problemRepo,
  problemStatementRepo,
  problemTemplateRepo,
  runTransaction,
  testcaseRepo,
  testcaseSetRepo,
  type TransactionClient
} from "@nojv/db";
import type {
  JudgeType,
  Language,
  PlatformRole,
  ProblemCreate,
  ProblemDifficulty,
  ProblemTestcaseSetCreate,
  ProblemUpdate,
  ProblemVisibility,
  SubmissionType,
  TestcaseSetUpdate,
  TestcaseUpdate
} from "@nojv/core";
import { DEFAULT_LOCALE } from "@nojv/core";

import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { ensureUser } from "../user/mutations";

// ─── Actor context (domain-level, no SvelteKit dependency) ──────────

/**
 * Minimal actor context required by problem mutations.
 * Mirrors the CompletedActorContext from apps/web but without SvelteKit coupling.
 */
export interface ProblemActorContext {
  userId: string;
  username: string;
  platformRole: PlatformRole;
}

// ─── Input types ────────────────────────────────────────────────────

export interface CreateProblemDefinitionInput {
  authorId?: string | undefined;
  checkerScript?: string | undefined;
  difficulty: ProblemDifficulty;
  inputFormat?: string | undefined;
  interactorScript?: string | undefined;
  judgeType?: JudgeType | undefined;
  memoryLimitMb?: number | undefined;
  outputFormat?: string | undefined;
  statement?: string | undefined;
  submissionType?: SubmissionType | undefined;
  summary: string;
  tags?: string[] | undefined;
  timeLimitMs?: number | undefined;
  title: string;
  visibility?: ProblemVisibility | undefined;
  pipelineConfig?: unknown;
  scoringScript?: string | undefined;
  scoringLanguage?: string | undefined;
  artifactPatterns?: string[] | undefined;
  networkAccessConfig?: unknown;
}

// ─── Shared problem helpers ─────────────────────────────────────────

export async function createProblemDefinition(
  tx: TransactionClient,
  problemSlug: string,
  input: CreateProblemDefinitionInput
) {
  // Cast needed: generated Prisma client is stale and missing pipeline fields.
  // TODO: remove cast after running `pnpm db:generate`
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const problem = await problemRepo.withTx(tx).create({
    authorId: input.authorId ?? null,
    checkerScript: input.checkerScript ?? null,
    defaultTitle: input.title,
    difficulty: input.difficulty,
    id: `problem_${problemSlug}`,
    interactorScript: input.interactorScript ?? null,
    judgeType: input.judgeType ?? "standard",
    memoryLimitMb: input.memoryLimitMb ?? 256,
    slug: problemSlug,
    submissionType: input.submissionType ?? "full_source",
    summary: input.summary,
    tags: input.tags ?? [],
    timeLimitMs: input.timeLimitMs ?? 1_000,
    visibility: input.visibility ?? "public",
    pipelineConfig: input.pipelineConfig ?? undefined,
    scoringScript: input.scoringScript ?? null,
    scoringLanguage: input.scoringLanguage ?? null,
    artifactPatterns: input.artifactPatterns ?? [],
    networkAccessConfig: input.networkAccessConfig ?? undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (input.statement) {
    await problemStatementRepo.withTx(tx).create({
      bodyMarkdown: input.statement,
      inputFormat: input.inputFormat ?? "",
      locale: DEFAULT_LOCALE,
      outputFormat: input.outputFormat ?? "",
      problemId: problem.id,
      title: input.title
    });
  }

  return problem;
}

export async function requireProblem(tx: TransactionClient, problemSlug: string) {
  const problem = await problemRepo.withTx(tx).findBySlug(problemSlug);

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemSlug}`);
  }

  return problem;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: ProblemActorContext
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new ForbiddenError(
      "Private problems can only be attached by their author or an admin."
    );
  }
}

export async function replaceTemplates(
  tx: TransactionClient,
  problemId: string,
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: Language;
    templateCode: string;
  }[]
) {
  // Lock the problem row to prevent concurrent template modifications
  await problemRepo.withTx(tx).lockForUpdate(problemId);

  await problemTemplateRepo.withTx(tx).deleteByProblemId(problemId);

  if (templates.length > 0) {
    await problemTemplateRepo.withTx(tx).createMany(
      templates.map((tpl) => ({
        driverCode: tpl.driverCode,
        insertionMarker: tpl.insertionMarker,
        language: tpl.language,
        problemId,
        templateCode: tpl.templateCode
      }))
    );
  }
}

function assertProblemOwnership(
  problem: { authorId: string | null },
  actor: ProblemActorContext
) {
  if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
    throw new ForbiddenError("Only the author or an admin can modify this problem.");
  }
}

export async function updateProblemTemplates(
  actor: ProblemActorContext,
  problemSlug: string,
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: Language;
    templateCode: string;
  }[]
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);
    assertProblemOwnership(problem, actor);

    await replaceTemplates(tx, problem.id, templates);

    return problemTemplateRepo.withTx(tx).findByProblemId(problem.id);
  });
}

export async function createProblemRecord(actor: ProblemActorContext, payload: ProblemCreate) {
  const slug =
    payload.slug ||
    payload.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  return runTransaction(async (tx) => {
    const existing = await problemRepo.withTx(tx).findBySlug(slug);

    if (existing) {
      throw new ConflictError(`Problem slug already exists: ${slug}`);
    }

    const author = await ensureUser(tx, actor.userId, actor);

    const problem = await createProblemDefinition(tx, slug, {
      authorId: author.id,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      judgeConfig: payload.judgeConfig,
      memoryLimitMb: payload.memoryLimitMb,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      status: payload.status,
      submissionType: payload.submissionType,
      summary: payload.summary,
      tags: payload.tags,
      timeLimitMs: payload.timeLimitMs,
      title: payload.title,
      visibility: payload.visibility
    });

    if (payload.templates.length > 0) {
      await replaceTemplates(tx, problem.id, payload.templates);
    }

    return problem;
  });
}

export async function updateProblemRecord(
  actor: ProblemActorContext,
  problemSlug: string,
  payload: ProblemUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);

    assertProblemOwnership(problem, actor);

    // Build the problem update data — only include fields that were provided
    const updateData: Record<string, unknown> = {};
    if (payload.title !== undefined) updateData.defaultTitle = payload.title;
    if (payload.difficulty !== undefined) updateData.difficulty = payload.difficulty;
    if (payload.visibility !== undefined) updateData.visibility = payload.visibility;
    if (payload.tags !== undefined) updateData.tags = payload.tags;
    if (payload.judgeType !== undefined) updateData.judgeType = payload.judgeType;
    if (payload.submissionType !== undefined)
      updateData.submissionType = payload.submissionType;
    if (payload.timeLimitMs !== undefined) updateData.timeLimitMs = payload.timeLimitMs;
    if (payload.memoryLimitMb !== undefined) updateData.memoryLimitMb = payload.memoryLimitMb;
    if (payload.checkerScript !== undefined) updateData.checkerScript = payload.checkerScript;
    if (payload.interactorScript !== undefined)
      updateData.interactorScript = payload.interactorScript;
    if (payload.summary !== undefined) updateData.summary = payload.summary;
    if (payload.pipelineConfig !== undefined)
      updateData.pipelineConfig = payload.pipelineConfig;
    if (payload.scoringScript !== undefined) updateData.scoringScript = payload.scoringScript;
    if (payload.scoringLanguage !== undefined)
      updateData.scoringLanguage = payload.scoringLanguage;
    if (payload.artifactPatterns !== undefined)
      updateData.artifactPatterns = payload.artifactPatterns;
    if (payload.networkAccessConfig !== undefined)
      updateData.networkAccessConfig = payload.networkAccessConfig;
    if (payload.judgeConfig !== undefined) updateData.judgeConfig = payload.judgeConfig;

    if (Object.keys(updateData).length > 0) {
      await problemRepo.withTx(tx).update(problem.id, updateData);
    }

    // Update statement if provided
    if (
      payload.statement !== undefined ||
      payload.inputFormat !== undefined ||
      payload.outputFormat !== undefined
    ) {
      await problemStatementRepo.withTx(tx).upsert(
        problem.id,
        DEFAULT_LOCALE,
        {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          locale: DEFAULT_LOCALE,
          outputFormat: payload.outputFormat ?? "",
          problemId: problem.id,
          title: payload.title ?? problem.defaultTitle
        },
        {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
          ...(payload.title !== undefined ? { title: payload.title } : {})
        }
      );
    }

    // Update templates if provided
    if (payload.templates !== undefined) {
      await replaceTemplates(tx, problem.id, payload.templates);
    }

    return { id: problem.id };
  });
}

export async function createProblemTestcaseSetRecord(
  actor: ProblemActorContext,
  problemSlug: string,
  payload: ProblemTestcaseSetCreate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);

    assertProblemOwnership(problem, actor);

    const testcaseSet = await testcaseSetRepo.withTx(tx).create({
      isHidden: payload.isHidden,
      name: payload.name,
      problemId: problem.id,
      weight: payload.weight
    });

    await testcaseRepo.withTx(tx).createMany(
      payload.cases.map((testcase, index) => ({
        expectedStdout: testcase.expectedStdout,
        ordinal: index + 1,
        stdin: testcase.stdin,
        testcaseSetId: testcaseSet.id
      }))
    );

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      isHidden: testcaseSet.isHidden,
      name: testcaseSet.name
    };
  });
}

export async function updateTestcaseSetRecord(
  actor: ProblemActorContext,
  problemSlug: string,
  setId: string,
  payload: TestcaseSetUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);
    assertProblemOwnership(problem, actor);

    return testcaseSetRepo.update(setId, payload);
  });
}

export async function deleteTestcaseSetRecord(
  actor: ProblemActorContext,
  problemSlug: string,
  setId: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);
    assertProblemOwnership(problem, actor);

    return testcaseSetRepo.delete(setId);
  });
}

export async function updateTestcaseRecord(
  actor: ProblemActorContext,
  problemSlug: string,
  testcaseId: string,
  payload: TestcaseUpdate
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);
    assertProblemOwnership(problem, actor);

    return testcaseRepo.update(testcaseId, payload);
  });
}

export async function deleteTestcaseRecord(
  actor: ProblemActorContext,
  problemSlug: string,
  testcaseId: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);
    assertProblemOwnership(problem, actor);

    return testcaseRepo.delete(testcaseId);
  });
}
