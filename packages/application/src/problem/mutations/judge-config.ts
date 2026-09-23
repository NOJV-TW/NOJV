import {
  Prisma,
  problemRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  testcaseSetRepo,
} from "@nojv/db";
import {
  advancedConfigSchema,
  type AdvancedJudgeConfiguration,
  type JudgeConfig,
  type JudgeScriptLanguage,
} from "@nojv/core";
import { assertStorageObjectPointer, type StorageObjectPointer } from "@nojv/storage";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { commitStoragePointerSwap } from "../../shared/storage-object-lifecycle";
import { writeCheckerScriptBlob, writeInteractorScriptBlob } from "../blobs";
import { parsePersistedJudgeConfig } from "../judge-config";
import {
  assertCanCreateAdvancedProblems,
  assertProblemEditAccess,
  lockProblemForEdit,
  type ProblemActorContext,
} from "../permissions";
import {
  optionalPointerSize,
  testcaseStoragePointers,
  testcaseStorageSize,
} from "./storage-pointers";

export interface SaveJudgeConfigInput {
  judgeConfig: JudgeConfig;
  checkerScript?: string | undefined;
  interactorScript?: string | undefined;
}

export async function saveProblemJudgeConfig(
  actor: ProblemActorContext,
  problemId: string,
  input: SaveJudgeConfigInput,
): Promise<{ id: string }> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  await assertProblemEditAccess(actor, problemId);

  const { type } = input.judgeConfig;
  const checkerBody =
    type === "checker" && (input.checkerScript ?? "").trim() ? input.checkerScript : null;
  const interactorBody =
    type === "interactive" && (input.interactorScript ?? "").trim()
      ? input.interactorScript
      : null;

  const checkerStorage =
    checkerBody == null ? null : await writeCheckerScriptBlob(problemId, checkerBody);
  const interactorStorage =
    interactorBody == null ? null : await writeInteractorScriptBlob(problemId, interactorBody);

  const judgeConfig: JudgeConfig = {
    type,
    ...(checkerStorage ? { checkerLanguage: input.judgeConfig.checkerLanguage } : {}),
    ...(interactorStorage ? { interactorLanguage: input.judgeConfig.interactorLanguage } : {}),
    ...(type === "standard" && input.judgeConfig.compare
      ? { compare: input.judgeConfig.compare }
      : {}),
    ...(input.judgeConfig.runtime ? { runtime: input.judgeConfig.runtime } : {}),
  };

  return runTransaction(async (tx) => {
    const current = await lockProblemForEdit(tx, actor, problemId);
    const previousBytes =
      optionalPointerSize(current.checkerStorage) +
      optionalPointerSize(current.interactorStorage);
    const nextBytes = (checkerStorage?.size ?? 0) + (interactorStorage?.size ?? 0);
    await problemRepo.withTx(tx).update(problemId, {
      referenceSolutionSubmissionId: null,
      judgeConfig,
      checkerStorage: checkerStorage ?? Prisma.DbNull,
      interactorStorage: interactorStorage ?? Prisma.DbNull,
      activeStorageBytes: { increment: nextBytes - previousBytes },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [checkerStorage, interactorStorage].filter(
        (pointer): pointer is StorageObjectPointer => pointer !== null,
      ),
      removed: [current.checkerStorage, current.interactorStorage]
        .filter((pointer) => pointer !== null)
        .map(assertStorageObjectPointer),
    });
    return { id: problemId };
  });
}

export async function updateAdvancedJudgeConfiguration(
  actor: ProblemActorContext,
  problemId: string,
  input: AdvancedJudgeConfiguration & { retainedImageRefs?: string[] },
): Promise<void> {
  await assertCanCreateAdvancedProblems(actor);
  await runTransaction(async (tx) => {
    const problem = await lockProblemForEdit(tx, actor, problemId);

    if (problem.status === "published") {
      throw new ConflictError("Published Advanced-mode judge configuration cannot be changed.");
    }
    if (problem.type !== "special_env") {
      throw new ConflictError(
        "Advanced judge configuration requires an Advanced-mode problem.",
      );
    }

    const current = advancedConfigSchema.safeParse(problem.advancedConfig);
    const currentRefs = current.success
      ? [
          current.data.run.imageRef,
          current.data.grade.imageRef,
          ...(current.data.network.mode === "service" && current.data.network.service
            ? [current.data.network.service.imageRef]
            : []),
        ]
      : [];
    if (input.retainedImageRefs?.some((ref) => !currentRefs.includes(ref))) {
      throw new ConflictError(
        "Advanced images changed during validation. Reload and try again.",
      );
    }

    await problemRepo.withTx(tx).update(problem.id, {
      advancedConfig: input.config,
      advancedRequiredPaths: input.requiredPaths,
      storageGeneration: { increment: 1 },
      referenceSolutionSubmissionId: null,
    });
  });
}

export async function convertProblemToAdvancedMode(
  actor: ProblemActorContext,
  problemId: string,
): Promise<void> {
  await assertCanCreateAdvancedProblems(actor);
  await runTransaction(async (tx) => {
    const problem = await lockProblemForEdit(tx, actor, problemId);

    if (problem.status !== "draft") {
      throw new ConflictError("Only draft problems can be converted to Advanced Mode.");
    }

    if (problem.type === "special_env") {
      throw new ConflictError("Problem is already a special_env problem.");
    }

    const [workspaceFiles, testcaseSets] = await Promise.all([
      problemWorkspaceFileRepo.withTx(tx).findByProblemId(problem.id),
      testcaseSetRepo.withTx(tx).findByProblemId(problem.id),
    ]);
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    await testcaseSetRepo.withTx(tx).deleteByProblemId(problem.id);

    const resetJudgeConfig = {
      type: "standard",
    } satisfies Prisma.InputJsonValue;

    await problemRepo.withTx(tx).update(problem.id, {
      referenceSolutionSubmissionId: null,
      type: "special_env",
      samples: Prisma.JsonNull,
      judgeConfig: resetJudgeConfig,
      advancedConfig: Prisma.JsonNull,
      checkerStorage: Prisma.DbNull,
      interactorStorage: Prisma.DbNull,
      activeStorageBytes: {
        decrement:
          workspaceFiles.reduce(
            (total, file) => total + assertStorageObjectPointer(file.contentStorage).size,
            0,
          ) +
          testcaseSets.reduce(
            (total, set) =>
              total +
              set.testcases.reduce(
                (caseTotal, testcase) => caseTotal + testcaseStorageSize(testcase),
                0,
              ),
            0,
          ) +
          optionalPointerSize(problem.checkerStorage) +
          optionalPointerSize(problem.interactorStorage),
      },
      storageGeneration: { increment: 1 },
    });
    await commitStoragePointerSwap(tx, {
      added: [],
      removed: [
        ...workspaceFiles.map(({ contentStorage }) =>
          assertStorageObjectPointer(contentStorage),
        ),
        ...testcaseSets.flatMap(({ testcases }) => testcases.flatMap(testcaseStoragePointers)),
        ...[problem.checkerStorage, problem.interactorStorage]
          .filter((pointer) => pointer !== null)
          .map(assertStorageObjectPointer),
      ],
    });
  });
}

export interface SetProblemInteractorInput {
  content: string;
  language: JudgeScriptLanguage;
}

export async function setProblemInteractor(
  actor: ProblemActorContext,
  problemId: string,
  input: SetProblemInteractorInput,
): Promise<{ id: string }> {
  await assertProblemEditAccess(actor, problemId);

  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  const existing = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
  return saveProblemJudgeConfig(actor, problemId, {
    judgeConfig: { ...existing, type: "interactive", interactorLanguage: input.language },
    interactorScript: input.content,
  });
}

export interface SetProblemCheckerInput {
  content: string;
  language: JudgeScriptLanguage;
}

export async function setProblemChecker(
  actor: ProblemActorContext,
  problemId: string,
  input: SetProblemCheckerInput,
): Promise<{ id: string }> {
  await assertProblemEditAccess(actor, problemId);

  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);

  const existing = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);

  return saveProblemJudgeConfig(actor, problemId, {
    judgeConfig: { ...existing, type: "checker", checkerLanguage: input.language },
    checkerScript: input.content,
  });
}
