import { getRegistryCredentialStatus } from "../registry/credentials";
import type { ActorContext } from "../shared/actor-context";
import { getProblemReferenceSolution } from "../submission/details";
import { hydrateValidatorScripts, hydrateWorkspaceFiles, summarizeTestcaseSets } from "./blobs";
import {
  getProblemPageData,
  getProblemRowById,
  getProblemTestcaseSets,
  listProblemWorkspaceFiles,
} from "./details";
import { hasVerifiedAdvancedJudgeRun } from "./mutations/publishing";
import {
  assertProblemContentReadAccess,
  canCreateAdvancedProblems,
  canProblemContentEdit,
  canPublishPublicProblems,
} from "./permissions";

export async function getProblemEditPageView(actor: ActorContext, problemId: string) {
  await assertProblemContentReadAccess(actor, problemId);

  const [problem, problemRow, rawTestcaseSets, rawWorkspaceFiles] = await Promise.all([
    getProblemPageData(problemId, { includeAdvancedConfig: true }),
    getProblemRowById(problemId),
    getProblemTestcaseSets(problemId),
    listProblemWorkspaceFiles(problemId),
  ]);

  const [workspaceFiles, validatorScripts] = await Promise.all([
    hydrateWorkspaceFiles(rawWorkspaceFiles),
    hydrateValidatorScripts({
      checkerStorage: problemRow?.checkerStorage,
      interactorStorage: problemRow?.interactorStorage,
    }),
  ]);
  const testcaseSets = summarizeTestcaseSets(rawTestcaseSets);

  const isAdvanced = problem.type === "special_env";
  const advancedCreationAllowed = await canCreateAdvancedProblems(actor);

  const advancedJudgeVerified = isAdvanced
    ? await hasVerifiedAdvancedJudgeRun(
        problemId,
        problem.advancedConfig,
        problem.advancedRequiredPaths,
        { totalTimeMs: problem.timeLimitMs, memoryMb: problem.memoryLimitMb },
      )
    : false;

  const referenceSolution = isAdvanced
    ? null
    : await getProblemReferenceSolution(actor, problemId);

  const registryCredential = isAdvanced
    ? await getRegistryCredentialStatus(actor.userId)
    : null;
  const publicVisibilityAllowed = await canPublishPublicProblems(actor);

  return {
    problem,
    adminMayPublish: problemRow?.adminMayPublish ?? false,
    testcaseSets,
    workspaceFiles,
    validatorScripts,
    advancedConfig: isAdvanced ? { config: problem.advancedConfig } : null,
    advancedJudgeVerified,
    referenceSolution,
    permissions: {
      canEdit:
        problemRow !== null &&
        (!isAdvanced || advancedCreationAllowed) &&
        (await canProblemContentEdit(problemRow, actor)),
      isAdmin: actor.platformRole === "admin",
      isOwner: problemRow?.authorId === actor.userId,
      publicVisibilityAllowed,
      canPublishPublicCopy:
        problemRow?.visibility === "private" &&
        publicVisibilityAllowed &&
        (problemRow.authorId === actor.userId ||
          (actor.platformRole === "admin" && problemRow.adminMayPublish)),
      canPublishAsAdmin:
        actor.platformRole === "admin" &&
        problemRow?.authorId !== actor.userId &&
        problemRow?.adminMayPublish === true,
    },
    advancedCreationAllowed,
    registryCredential: registryCredential
      ? {
          username: registryCredential.username,
          updatedAt: registryCredential.updatedAt,
          lastUsedAt: registryCredential.lastUsedAt,
        }
      : null,
  };
}
