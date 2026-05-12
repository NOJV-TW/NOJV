import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import {
  languageSchema,
  problemCreateSchema,
  problemImageSourceSchema,
  problemTestcaseSetCreateSchema,
  problemTypeSchema,
  problemWorkspaceFileSchema,
  requiredPathsSchema,
  runtimeSchema,
  testcaseSetUpdateSchema,
  testcaseUpdateSchema,
  judgeConfigSchema,
} from "@nojv/core";
import type { ProblemType } from "@nojv/core";
import { message, superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth, type CompletedActorContext } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { parseJsonField, readStringField } from "$lib/server/shared/form-utils";
import { problemDomain } from "@nojv/domain";
import { createStorageClient, getText } from "@nojv/storage";

const {
  getProblemPageData,
  getProblemTestcaseSets,
  listProblemWorkspaceFiles,
  updateProblemRecord,
  updateProblemWorkspace,
  createProblemTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
  deleteProblemRecord,
  convertProblemToAdvancedMode,
  setTestcaseSetScoringStrategy,
  updateAdvancedRequiredPaths,
} = problemDomain;

const updateWorkspaceSchema = z.object({
  runtime: runtimeSchema.optional(),
  allowedLanguages: z.array(languageSchema).optional(),
  type: problemTypeSchema.optional(),
  files: z.array(problemWorkspaceFileSchema).max(50),
});

// Save payload: the image ref + source plus the time/memory limit columns.
// Only used when problem.type === "special_env".
const advancedImageSavePayloadSchema = z.object({
  source: problemImageSourceSchema,
  ref: z.string().min(1).max(500),
  timeLimitMs: z.coerce.number().int().min(1_000).max(300_000).optional(),
  memoryLimitMb: z.coerce.number().int().min(16).max(4_096).optional(),
});

const advancedRequiredPathsSavePayloadSchema = z.object({
  paths: requiredPathsSchema,
});

export const load: PageServerLoad = handleLoad(
  async ({ params, locals }: PageServerLoadEvent) => {
    if (!locals.user) {
      redirect(302, `/problems/${params.problemId}`);
    }

    // Ownership gate BEFORE loading testcase I/O or workspace file
    // content from S3 — actions used to be the only authz layer, but
    // the load handler itself streams raw testcases + solution-template
    // file bodies to the client, which should only ever reach the author
    // or an admin. Without this, any logged-in user could GET this page
    // for somebody else's problem and exfiltrate hidden testcases.
    const actor = requireAuth({ locals, params } as RequestEvent);
    await problemDomain.assertProblemEditAccess(actor, params.problemId);

    const [problem, rawTestcaseSets, rawWorkspaceFiles] = await Promise.all([
      getProblemPageData(params.problemId),
      getProblemTestcaseSets(params.problemId),
      listProblemWorkspaceFiles(params.problemId),
    ]);

    // Hydrate every testcase + workspace blob from S3 in parallel. The
    // edit page is not a hot path; the extra round trip is fine.
    const storage = createStorageClient();

    const testcaseSets = await Promise.all(
      rawTestcaseSets.map(async (set) => {
        const testcases = await Promise.all(
          set.testcases.map(async (tc) => {
            const [inputText, outputText] = await Promise.all([
              getText(storage, tc.inputKey),
              tc.outputKey ? getText(storage, tc.outputKey) : Promise.resolve(null),
            ]);
            return {
              id: tc.id,
              ordinal: tc.ordinal,
              input: inputText,
              output: outputText,
            };
          }),
        );
        return {
          id: set.id,
          name: set.name,
          description: set.description,
          weight: set.weight,
          ordinal: set.ordinal,
          scoringStrategy: set.scoringStrategy,
          testcases,
        };
      }),
    );

    const workspaceFiles = await Promise.all(
      rawWorkspaceFiles.map(async (f) => ({
        id: f.id,
        problemId: f.problemId,
        language: f.language,
        path: f.path,
        content: await getText(storage, f.contentKey),
        visibility: f.visibility,
        description: f.description,
        orderIndex: f.orderIndex,
      })),
    );

    // For special_env problems include advancedImageRef/advancedImageSource so
    // problemCreateSchema's superRefine passes — BasicInfoTab never binds those
    // fields but they ride along in $form and get submitted.
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
        status: problem.status,
        tags: problem.tags,
        timeLimitMs: problem.timeLimitMs,
        title: problem.title,
        type: problem.type satisfies ProblemType,
        visibility: problem.visibility,
        ...(isAdvanced
          ? {
              advancedImageRef: problem.advancedImageRef ?? "",
              advancedImageSource: problem.advancedImageSource ?? "registry",
            }
          : {}),
      },
      zod4(problemCreateSchema),
    );

    return {
      problem,
      form,
      testcaseSets,
      workspaceFiles,
      imageConfig: isAdvanced
        ? {
            source: problem.advancedImageSource ?? "registry",
            ref: problem.advancedImageRef ?? "",
            timeLimitMs: problem.timeLimitMs,
            memoryLimitMb: problem.memoryLimitMb,
          }
        : null,
    };
  },
);

function problemEditAction<T>(
  handler: (ctx: {
    actor: CompletedActorContext;
    problemId: string;
    event: RequestEvent;
  }) => Promise<T>,
) {
  return async (event: RequestEvent) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.problemId;
    if (!problemId) error(400, "Missing problem id");

    return handler({ actor, problemId, event });
  };
}

// Shared judgeConfig save handler. The edit UI has two tabs (Judge
// and Scoring) that each POST to a distinct action name, but the
// server-side work is identical — parse judgeConfigSchema and write
// it back. Aliasing both action names to one handler removes the
// copy that previously had to be kept in sync by hand.
const saveJudgeConfig = problemEditAction(async ({ actor, problemId, event }) => {
  const formData = await event.request.formData();
  const judgeConfig = parseJsonField(formData.get("data"), judgeConfigSchema);
  await updateProblemRecord(actor, problemId, { judgeConfig });
  return { success: true };
});

export const actions: Actions = {
  update: problemEditAction(async ({ actor, problemId, event }) => {
    const form = await superValidate(event, zod4(problemCreateSchema));
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

  updateTestcaseSetScoring: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const setId = readStringField(formData.get("setId"), "setId");
    const rawStrategy = readStringField(formData.get("strategy"), "strategy");
    await setTestcaseSetScoringStrategy(actor, problemId, setId, rawStrategy);
    return { success: true };
  }),

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

  // Convert a Standard Mode problem to Advanced Mode. This is
  // intentionally destructive — workspace files, testcase sets, samples,
  // and judge config are discarded. Requires an explicit `confirm=yes`
  // field on the POST body to guard against accidental submissions.
  // The same /edit route renders the advanced layout when problem.type
  // becomes "special_env", so we just reload the same URL after converting.
  convertToAdvanced: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    if (formData.get("confirm") !== "yes") {
      return fail(400, { message: "Conversion not confirmed" });
    }
    await convertProblemToAdvancedMode(actor, problemId);
    redirect(303, `/problems/${problemId}/edit`);
  }),

  updateImage: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), advancedImageSavePayloadSchema);
    try {
      await updateProblemRecord(actor, problemId, {
        type: "special_env",
        advancedImageRef: data.ref,
        advancedImageSource: data.source,
        ...(data.timeLimitMs !== undefined ? { timeLimitMs: data.timeLimitMs } : {}),
        ...(data.memoryLimitMb !== undefined ? { memoryLimitMb: data.memoryLimitMb } : {}),
      });
    } catch (err) {
      return fail(400, { message: err instanceof Error ? err.message : "Update failed" });
    }
    return { success: true };
  }),

  updateRequiredPaths: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), advancedRequiredPathsSavePayloadSchema);
    try {
      await updateAdvancedRequiredPaths(actor, problemId, data.paths);
    } catch (err) {
      return fail(400, { message: err instanceof Error ? err.message : "Update failed" });
    }
    return { success: true };
  }),
};
