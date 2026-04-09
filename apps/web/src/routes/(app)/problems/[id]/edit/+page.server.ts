import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import {
  languageSchema,
  problemCreateSchema,
  problemTestcaseSetCreateSchema,
  problemWorkspaceFileSchema,
  runtimeSchema,
  testcaseSetUpdateSchema,
  testcaseUpdateSchema,
  judgeConfigSchema
} from "@nojv/core";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth, type CompletedActorContext } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { problemDomain } from "@nojv/domain";
import { problemWorkspaceFileRepo } from "@nojv/db";

const {
  getProblemPageData,
  getProblemTestcaseSets,
  updateProblemRecord,
  updateProblemWorkspace,
  createProblemTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
  deleteProblemRecord,
  convertProblemToAdvancedMode
} = problemDomain;

const updateWorkspaceSchema = z.object({
  runtime: runtimeSchema.optional(),
  allowedLanguages: z.array(languageSchema).optional(),
  files: z.array(problemWorkspaceFileSchema).max(50)
});

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.id}`);
  }

  const [problem, testcaseSets, workspaceFiles] = await Promise.all([
    getProblemPageData(params.id),
    getProblemTestcaseSets(params.id),
    problemWorkspaceFileRepo.findByProblemId(params.id)
  ]);

  if (!problem) {
    error(404, "Problem not found");
  }

  const form = await superValidate(
    {
      difficulty: problem.difficulty,
      inputFormat: problem.inputFormat,
      judgeConfig: problem.judgeConfig,
      memoryLimitMb: problem.memoryLimitMb,
      mode: problem.mode,
      outputFormat: problem.outputFormat,
      samples: problem.samples,
      statement: problem.statement,
      status: problem.status,
      submissionType: problem.submissionType,
      summary: problem.summary,
      tags: problem.tags,
      timeLimitMs: problem.timeLimitMs,
      title: problem.title,
      visibility: problem.visibility
    },
    zod4(problemCreateSchema)
  );

  return { problem, form, testcaseSets, workspaceFiles };
};

// ─── Form action helpers ─────────────────────────────────────────────

/**
 * Wrap a problem-edit form action with the standard pre-action flow:
 * rate-limit → auth → extract problemId. The handler receives a context
 * with `actor`, `problemId`, and `event` already prepared.
 */
function problemEditAction<T>(
  handler: (ctx: {
    actor: CompletedActorContext;
    problemId: string;
    event: RequestEvent;
  }) => Promise<T>
) {
  return async (event: RequestEvent) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    if (!problemId) error(400, "Missing problem id");

    return handler({ actor, problemId, event });
  };
}

/** Read a JSON-encoded form field and validate it with a Zod schema. */
function parseJsonField<T>(
  raw: FormDataEntryValue | null,
  schema: z.ZodType<T>,
  fieldName = "data"
): T {
  if (typeof raw !== "string") error(400, `Missing ${fieldName} field`);
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) error(400, `Invalid ${fieldName}`);
  return parsed.data;
}

/** Read a required string form field (e.g. an ID). */
function readStringField(raw: FormDataEntryValue | null, fieldName: string): string {
  if (typeof raw !== "string") error(400, `Missing ${fieldName}`);
  return raw;
}

// ─── Form actions ────────────────────────────────────────────────────

export const actions: Actions = {
  update: problemEditAction(async ({ actor, problemId, event }) => {
    const form = await superValidate(event, zod4(problemCreateSchema));
    if (!form.valid) return fail(400, { form });
    const result = await updateProblemRecord(actor, problemId, form.data);
    return { form, id: result.id, success: true };
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

  // NOTE: updateJudgeConfig and updateScoring are identical — both parse
  // judgeConfigSchema and call updateProblemRecord with `{ judgeConfig }`.
  // They remain separate because distinct UI tabs POST to each name.
  updateJudgeConfig: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const judgeConfig = parseJsonField(formData.get("data"), judgeConfigSchema);
    await updateProblemRecord(actor, problemId, { judgeConfig });
    return { success: true };
  }),

  updateScoring: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const judgeConfig = parseJsonField(formData.get("data"), judgeConfigSchema);
    await updateProblemRecord(actor, problemId, { judgeConfig });
    return { success: true };
  }),

  updateWorkspace: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), updateWorkspaceSchema);
    const result = await updateProblemWorkspace(actor, problemId, {
      ...(data.runtime ? { runtime: data.runtime } : {}),
      ...(data.allowedLanguages ? { allowedLanguages: data.allowedLanguages } : {}),
      files: data.files.map((f) => ({
        language: f.language,
        path: f.path,
        content: f.content,
        visibility: f.visibility,
        editableRegions: (f.editableRegions as [number, number][] | null) ?? null,
        orderIndex: f.orderIndex
      }))
    });
    return { success: true, fileCount: result.fileCount };
  }),

  publish: problemEditAction(async ({ actor, problemId }) => {
    await updateProblemRecord(actor, problemId, { status: "published" });
    return { success: true };
  }),

  deleteProblem: problemEditAction(async ({ actor, problemId }) => {
    // Only draft problems can be deleted
    const problem = await getProblemPageData(problemId);
    if (problem?.status !== "draft") {
      error(403, "Published problems cannot be deleted");
    }

    await deleteProblemRecord(actor, problemId);
    redirect(302, "/problems?tab=mine");
  }),

  // Convert a Standard Mode problem to Advanced Mode. This is
  // intentionally destructive — workspace files, testcase sets, samples,
  // and judge config are discarded. Requires an explicit `confirm=yes`
  // field on the POST body to guard against accidental submissions.
  convertToAdvanced: problemEditAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    if (formData.get("confirm") !== "yes") {
      return fail(400, { message: "Conversion not confirmed" });
    }
    await convertProblemToAdvancedMode(actor, problemId);
    redirect(303, `/problems/${problemId}/edit-advanced`);
  })
};
