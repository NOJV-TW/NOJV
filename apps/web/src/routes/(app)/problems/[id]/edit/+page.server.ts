import { error, fail, redirect } from "@sveltejs/kit";
import {
  problemUpdateSchema,
  problemTemplateSchema,
  problemTestcaseSetCreateSchema,
  testcaseSetUpdateSchema,
  testcaseUpdateSchema,
  judgeConfigSchema
} from "@nojv/core";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import {
  getProblemPageData,
  getProblemTestcaseSets,
  updateProblemRecord,
  updateProblemTemplates,
  createProblemTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord
} from "$lib/server/problem/queries";

const updateTemplatesSchema = z.array(problemTemplateSchema).max(10);

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.id}`);
  }

  const [problem, testcaseSets] = await Promise.all([
    getProblemPageData(params.id),
    getProblemTestcaseSets(params.id)
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
      outputFormat: problem.outputFormat,
      statement: problem.statement,
      status: problem.status,
      submissionType: problem.submissionType,
      summary: problem.summary,
      tags: problem.tags,
      templates: [],
      timeLimitMs: problem.timeLimitMs,
      title: problem.title,
      visibility: problem.visibility
    },
    zod4(problemUpdateSchema)
  );

  return { problem, form, testcaseSets };
};

export const actions: Actions = {
  update: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const form = await superValidate(event, zod4(problemUpdateSchema));
    if (!form.valid) return fail(400, { form });
    const result = await updateProblemRecord(actor, problemId, form.data);

    return { form, id: result.id, success: true };
  },

  updateTemplates: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data field");
    const parsed = updateTemplatesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) error(400, "Invalid template data");
    const result = await updateProblemTemplates(actor, problemId, parsed.data);

    return { success: true, templates: result };
  },

  createTestcaseSet: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data field");
    const parsed = problemTestcaseSetCreateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) error(400, "Invalid testcase set data");
    const result = await createProblemTestcaseSetRecord(actor, problemId, parsed.data);

    return { id: result.id, success: true };
  },

  updateTestcaseSet: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const setId = formData.get("setId");
    const raw = formData.get("data");
    if (typeof setId !== "string") error(400, "Missing setId");
    if (typeof raw !== "string") error(400, "Missing data field");
    const parsed = testcaseSetUpdateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) error(400, "Invalid testcase set data");
    await updateTestcaseSetRecord(actor, problemId, setId, parsed.data);

    return { success: true };
  },

  deleteTestcaseSet: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const setId = formData.get("setId");
    if (typeof setId !== "string") error(400, "Missing setId");
    await deleteTestcaseSetRecord(actor, problemId, setId);

    return { success: true };
  },

  updateTestcase: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const testcaseId = formData.get("testcaseId");
    const raw = formData.get("data");
    if (typeof testcaseId !== "string") error(400, "Missing testcaseId");
    if (typeof raw !== "string") error(400, "Missing data field");
    const parsed = testcaseUpdateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) error(400, "Invalid testcase data");
    await updateTestcaseRecord(actor, problemId, testcaseId, parsed.data);

    return { success: true };
  },

  deleteTestcase: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const testcaseId = formData.get("testcaseId");
    if (typeof testcaseId !== "string") error(400, "Missing testcaseId");
    await deleteTestcaseRecord(actor, problemId, testcaseId);

    return { success: true };
  },

  updateJudgeConfig: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data");
    const parsed = judgeConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) error(400, "Invalid judge config");
    await updateProblemRecord(actor, problemId, { judgeConfig: parsed.data });

    return { success: true };
  },

  updateScoring: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data");
    const parsed = judgeConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) error(400, "Invalid scoring config");
    await updateProblemRecord(actor, problemId, { judgeConfig: parsed.data });

    return { success: true };
  },

  publish: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const problemId = event.params.id;
    await updateProblemRecord(actor, problemId, { status: "published" });

    return { success: true };
  }
};
