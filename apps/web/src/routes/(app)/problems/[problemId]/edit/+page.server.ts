import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import {
  languageSchema,
  problemDraftSchema,
  problemTestcaseSetCreateSchema,
  problemTypeSchema,
  problemWorkspaceFileSchema,
  runtimeSchema,
  testcaseSetUpdateSchema,
  testcaseUpdateSchema,
  judgeConfigSchema,
  problemTags,
} from "@nojv/core";
import type { ProblemType } from "@nojv/core";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth, type CompletedActorContext } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { parseJsonField, readStringField } from "$lib/server/shared/form-utils";
import {
  advancedImageConfigInputSchema,
  allowedImageRegistries,
  buildAdvancedConfigFromInput,
} from "$lib/server/advanced-image-config";
import { getWebEnv } from "$lib/server/env";
import { problemDomain, registryDomain } from "@nojv/application";

const {
  getProblemPageData,
  getProblemTestcaseSets,
  listProblemWorkspaceFiles,
  hydrateTestcaseSets,
  hydrateWorkspaceFiles,
  hydrateValidatorScripts,
  saveProblemJudgeConfig,
  updateProblemRecord,
  updateProblemWorkspace,
  createProblemTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
  deleteProblemRecord,
  convertProblemToAdvancedMode,
} = problemDomain;

const updateWorkspaceSchema = z.object({
  runtime: runtimeSchema.optional(),
  allowedLanguages: z.array(languageSchema).optional(),
  type: problemTypeSchema.optional(),
  files: z.array(problemWorkspaceFileSchema).max(50),
});

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const { params, locals } = event;
  if (!locals.user) {
    redirect(302, `/problems/${params.problemId}`);
  }

  const actor = requireAuth(event);
  await problemDomain.assertProblemEditAccess(actor, params.problemId);

  const [problem, rawTestcaseSets, rawWorkspaceFiles] = await Promise.all([
    getProblemPageData(params.problemId, { includeAdvancedConfig: true }),
    getProblemTestcaseSets(params.problemId),
    listProblemWorkspaceFiles(params.problemId),
  ]);

  const [testcaseSets, workspaceFiles, validatorScripts] = await Promise.all([
    hydrateTestcaseSets(rawTestcaseSets),
    hydrateWorkspaceFiles(rawWorkspaceFiles),
    hydrateValidatorScripts({
      checkerKey: problem.judgeConfig.checkerKey,
      interactorKey: problem.judgeConfig.interactorKey,
    }),
  ]);

  const isAdvanced = problem.type === "special_env";
  const form = await superValidate(
    {
      difficulty: problem.difficulty,
      inputFormat: problem.inputFormat,
      judgeConfig: problem.judgeConfig,
      memoryLimitMb: problem.memoryLimitMb,
      outputFormat: problem.outputFormat,
      samples: problem.samples,
      statement: problem.statement,
      tags: problem.tags.filter((tag) => (problemTags as readonly string[]).includes(tag)),
      timeLimitMs: problem.timeLimitMs,
      title: problem.title,
      type: problem.type satisfies ProblemType,
      visibility: problem.visibility,
    },
    zod4(problemDraftSchema),
  );

  const advancedJudgeVerified = isAdvanced
    ? await problemDomain.hasVerifiedAdvancedJudgeRun(params.problemId, problem.advancedConfig)
    : false;

  const registryEnv = getWebEnv();
  const registryCredential = isAdvanced
    ? await registryDomain.getRegistryCredentialStatus(actor.userId)
    : null;

  return {
    problem,
    form,
    testcaseSets,
    workspaceFiles,
    validatorScripts,
    advancedConfig: isAdvanced
      ? {
          config: problem.advancedConfig,
        }
      : null,
    advancedJudgeVerified,
    advancedCreationAllowed: await problemDomain.canCreateAdvancedProblems(actor),
    advancedAllowedRegistries: allowedImageRegistries(),
    registryHost: registryEnv.REGISTRY_PUBLIC_HOST,
    registryCredential: registryCredential
      ? {
          username: registryCredential.username,
          updatedAt: registryCredential.updatedAt,
          lastUsedAt: registryCredential.lastUsedAt,
        }
      : null,
  };
});

function problemEditAction<T>(
  handler: (ctx: {
    actor: CompletedActorContext;
    problemId: string;
    event: RequestEvent;
  }) => Promise<T>,
) {
  return withAction(async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const problemId = event.params.problemId;
    if (!problemId) error(400, "Missing problem id");

    return handler({ actor, problemId, event });
  });
}

const saveJudgeConfig = problemEditAction(async ({ actor, problemId, event }) => {
  const formData = await event.request.formData();
  const judgeConfig = parseJsonField(formData.get("data"), judgeConfigSchema);
  const checkerScript = formData.get("checkerScript");
  const interactorScript = formData.get("interactorScript");
  await saveProblemJudgeConfig(actor, problemId, {
    judgeConfig,
    ...(typeof checkerScript === "string" ? { checkerScript } : {}),
    ...(typeof interactorScript === "string" ? { interactorScript } : {}),
  });
  return { success: true };
});

export const actions: Actions = {
  update: problemEditAction(async ({ actor, problemId, event }) => {
    const form = await superValidate(event, zod4(problemDraftSchema));
    if (!form.valid) return fail(400, { form });
    await updateProblemRecord(actor, problemId, form.data);
    return message(form, "ok");
  }),

  createTestcaseSet: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), problemTestcaseSetCreateSchema);
    const result = await createProblemTestcaseSetRecord(actor, problemId, data);
    return { id: result.id, success: true };
  }),

  updateTestcaseSet: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const setId = readStringField(formData.get("setId"), "setId");
    const data = parseJsonField(formData.get("data"), testcaseSetUpdateSchema);
    await updateTestcaseSetRecord(actor, problemId, setId, data);
    return { success: true };
  }),

  deleteTestcaseSet: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const setId = readStringField(formData.get("setId"), "setId");
    await deleteTestcaseSetRecord(actor, problemId, setId);
    return { success: true };
  }),

  updateTestcase: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const testcaseId = readStringField(formData.get("testcaseId"), "testcaseId");
    const data = parseJsonField(formData.get("data"), testcaseUpdateSchema);
    await updateTestcaseRecord(actor, problemId, testcaseId, data);
    return { success: true };
  }),

  deleteTestcase: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const testcaseId = readStringField(formData.get("testcaseId"), "testcaseId");
    await deleteTestcaseRecord(actor, problemId, testcaseId);
    return { success: true };
  }),

  updateJudgeConfig: saveJudgeConfig,
  updateScoring: saveJudgeConfig,

  updateWorkspace: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), updateWorkspaceSchema);
    const result = await updateProblemWorkspace(actor, problemId, {
      ...(data.runtime ? { runtime: data.runtime } : {}),
      ...(data.allowedLanguages ? { allowedLanguages: data.allowedLanguages } : {}),
      ...(data.type ? { type: data.type } : {}),
      files: data.files.map((f) => ({
        language: f.language,
        path: f.path,
        content: f.content,
        visibility: f.visibility,
        orderIndex: f.orderIndex,
      })),
    });
    return { success: true, fileCount: result.fileCount };
  }),

  publish: problemEditAction(async ({ actor, problemId }) => {
    await updateProblemRecord(actor, problemId, { status: "published" });
    return { success: true };
  }),

  deleteProblem: problemEditAction(async ({ actor, problemId }) => {
    const problem = await getProblemPageData(problemId);
    if (problem.status !== "draft") {
      error(403, "Published problems cannot be deleted");
    }

    await deleteProblemRecord(actor, problemId);
    redirect(302, "/problems?tab=mine");
  }),

  convertToAdvanced: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    if (formData.get("confirm") !== "yes") {
      return fail(400, { message: "Conversion not confirmed" });
    }
    await convertProblemToAdvancedMode(actor, problemId);
    redirect(303, `/problems/${problemId}/edit`);
  }),

  updateAdvancedConfig: problemEditAction(async ({ actor, problemId, event }) => {
    await problemDomain.assertCanCreateAdvancedProblems(actor);
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") return fail(400, { error: "Missing data field" });

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(400, { error: "Invalid data: not valid JSON" });
    }

    const parsed = advancedImageConfigInputSchema.safeParse(json);
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues.map((issue) => issue.message).join(" ") });
    }

    await updateProblemRecord(actor, problemId, {
      advancedConfig: buildAdvancedConfigFromInput(parsed.data),
    });
    await problemDomain.updateAdvancedRequiredPaths(
      actor,
      problemId,
      parsed.data.requiredPaths,
    );
    return { success: true };
  }),

  generateRegistryCredential: problemEditAction(async ({ actor }) => {
    const credential = await registryDomain.generateRegistryCredential(actor);
    return {
      success: true,
      username: credential.username,
      password: credential.password,
    };
  }),
};
