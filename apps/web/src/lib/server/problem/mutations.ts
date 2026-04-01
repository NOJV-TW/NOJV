import { prisma, type TransactionClient } from "@nojv/db";
import type {
  JudgeType,
  Language,
  ProblemCreate,
  ProblemDifficulty,
  ProblemTestcaseSetCreate,
  ProblemUpdate,
  ProblemVisibility,
  SubmissionType
} from "@nojv/core";

import { DEFAULT_LOCALE } from "$lib/utils";
import type { CompletedActorContext } from "../auth";
import { ConflictError, ForbiddenError, NotFoundError } from "../auth";
import { ensureUser } from "../user/mutations";

export interface CreateProblemDefinitionInput {
  authorId?: string;
  checkerScript?: string | undefined;
  difficulty: ProblemDifficulty;
  inputFormat?: string;
  interactorScript?: string | undefined;
  judgeType?: JudgeType;
  memoryLimitMb?: number;
  outputFormat?: string;
  statement?: string;
  submissionType?: SubmissionType;
  summary: string;
  tags?: string[];
  timeLimitMs?: number;
  title: string;
  visibility?: ProblemVisibility;
  pipelineConfig?: unknown;
  scoringScript?: string;
  scoringLanguage?: string;
  artifactPatterns?: string[];
  networkAccessConfig?: unknown;
}

// --- Shared problem helpers ---

export async function createProblemDefinition(
  tx: TransactionClient,
  problemSlug: string,
  input: CreateProblemDefinitionInput
) {
  const problem = await tx.problem.create({
    data: {
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
    }
  });

  if (input.statement) {
    await tx.problemStatementI18n.create({
      data: {
        bodyMarkdown: input.statement,
        inputFormat: input.inputFormat ?? "",
        locale: DEFAULT_LOCALE,
        outputFormat: input.outputFormat ?? "",
        problemId: problem.id,
        title: input.title
      }
    });
  }

  return problem;
}

export async function requireProblem(tx: TransactionClient, problemSlug: string) {
  const problem = await tx.problem.findUnique({
    where: {
      slug: problemSlug
    }
  });

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemSlug}`);
  }

  return problem;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: CompletedActorContext
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
  await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${problemId} FOR UPDATE`;

  await tx.problemTemplate.deleteMany({ where: { problemId } });

  if (templates.length > 0) {
    await tx.problemTemplate.createMany({
      data: templates.map((tpl) => ({
        driverCode: tpl.driverCode,
        insertionMarker: tpl.insertionMarker,
        language: tpl.language,
        problemId,
        templateCode: tpl.templateCode
      }))
    });
  }
}

function assertProblemOwnership(
  problem: { authorId: string | null },
  actor: CompletedActorContext
) {
  if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
    throw new ForbiddenError("Only the author or an admin can modify this problem.");
  }
}

export async function updateProblemTemplates(
  actor: CompletedActorContext,
  problemSlug: string,
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: Language;
    templateCode: string;
  }[]
) {
  return prisma.$transaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);
    assertProblemOwnership(problem, actor);

    await replaceTemplates(tx, problem.id, templates);

    return tx.problemTemplate.findMany({
      orderBy: { language: "asc" },
      where: { problemId: problem.id }
    });
  });
}

export async function createProblemRecord(
  actor: CompletedActorContext,
  payload: ProblemCreate
) {
  const slug =
    payload.slug ||
    payload.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.problem.findUnique({
      where: {
        slug
      }
    });

    if (existing) {
      throw new ConflictError(`Problem slug already exists: ${slug}`);
    }

    const author = await ensureUser(tx, actor.userId, actor);

    const problem = await createProblemDefinition(tx, slug, {
      authorId: author.id,
      checkerScript: payload.checkerScript,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      interactorScript: payload.interactorScript,
      judgeType: payload.judgeType,
      memoryLimitMb: payload.memoryLimitMb,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      submissionType: payload.submissionType,
      summary: payload.summary,
      tags: payload.tags,
      timeLimitMs: payload.timeLimitMs,
      title: payload.title,
      visibility: payload.visibility,
      pipelineConfig: payload.pipelineConfig,
      scoringScript: payload.scoringScript,
      scoringLanguage: payload.scoringLanguage,
      artifactPatterns: payload.artifactPatterns,
      networkAccessConfig: payload.networkAccessConfig
    });

    if (payload.templates.length > 0) {
      await replaceTemplates(tx, problem.id, payload.templates);
    }

    return problem;
  });
}

export async function updateProblemRecord(
  actor: CompletedActorContext,
  problemSlug: string,
  payload: ProblemUpdate
) {
  return prisma.$transaction(async (tx) => {
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
    if (payload.pipelineConfig !== undefined) updateData.pipelineConfig = payload.pipelineConfig;
    if (payload.scoringScript !== undefined) updateData.scoringScript = payload.scoringScript;
    if (payload.scoringLanguage !== undefined) updateData.scoringLanguage = payload.scoringLanguage;
    if (payload.artifactPatterns !== undefined) updateData.artifactPatterns = payload.artifactPatterns;
    if (payload.networkAccessConfig !== undefined) updateData.networkAccessConfig = payload.networkAccessConfig;

    if (Object.keys(updateData).length > 0) {
      await tx.problem.update({
        data: updateData,
        where: { id: problem.id }
      });
    }

    // Update statement if provided
    if (
      payload.statement !== undefined ||
      payload.inputFormat !== undefined ||
      payload.outputFormat !== undefined
    ) {
      await tx.problemStatementI18n.upsert({
        create: {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          locale: DEFAULT_LOCALE,
          outputFormat: payload.outputFormat ?? "",
          problemId: problem.id,
          title: payload.title ?? problem.defaultTitle
        },
        update: {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
          ...(payload.title !== undefined ? { title: payload.title } : {})
        },
        where: {
          problemId_locale: { locale: DEFAULT_LOCALE, problemId: problem.id }
        }
      });
    }

    // Update templates if provided
    if (payload.templates !== undefined) {
      await replaceTemplates(tx, problem.id, payload.templates);
    }

    return { id: problem.id };
  });
}

export async function createProblemTestcaseSetRecord(
  actor: CompletedActorContext,
  problemSlug: string,
  payload: ProblemTestcaseSetCreate
) {
  return prisma.$transaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);

    assertProblemOwnership(problem, actor);

    const testcaseSet = await tx.testcaseSet.create({
      data: {
        isHidden: payload.isHidden,
        name: payload.name,
        problemId: problem.id,
        weight: payload.weight
      }
    });

    await tx.testcase.createMany({
      data: payload.cases.map((testcase, index) => ({
        expectedStdout: testcase.expectedStdout,
        ordinal: index + 1,
        stdin: testcase.stdin,
        testcaseSetId: testcaseSet.id
      }))
    });

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      isHidden: testcaseSet.isHidden,
      name: testcaseSet.name
    };
  });
}
