import { error, fail, redirect } from "@sveltejs/kit";
import {
  problemUpdateSchema,
  problemTemplateSchema,
  problemTestcaseSetCreateSchema
} from "@nojv/core";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { problemDomain } from "@nojv/domain";
import { getProblemPageData } from "$lib/server/problem/queries";

const { updateProblemRecord, updateProblemTemplates, createProblemTestcaseSetRecord } = problemDomain;

const updateTemplatesSchema = z.array(problemTemplateSchema).max(10);

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.slug}`);
  }

  const problem = await getProblemPageData(params.slug);

  if (!problem) {
    error(404, "Problem not found");
  }

  const form = await superValidate(
    {
      checkerScript: problem.checkerScript ?? "",
      difficulty: problem.difficulty,
      inputFormat: problem.inputFormat,
      interactorScript: problem.interactorScript ?? "",
      judgeType: problem.judgeType,
      memoryLimitMb: problem.memoryLimitMb,
      outputFormat: problem.outputFormat,
      statement: problem.statement,
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

  return { problem, form };
};

export const actions: Actions = {
  update: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const slug = event.params.slug;
    const form = await superValidate(event, zod4(problemUpdateSchema));
    if (!form.valid) return fail(400, { form });
    const result = await updateProblemRecord(actor, slug, form.data);

    return { form, id: result.id, success: true };
  },

  updateTemplates: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const slug = event.params.slug;
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data field");
    const templates = updateTemplatesSchema.parse(JSON.parse(raw));
    const result = await updateProblemTemplates(actor, slug, templates);

    return { success: true, templates: result };
  },

  createTestcaseSet: async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;

    const actor = requireAuth(event);
    const slug = event.params.slug;
    const formData = await event.request.formData();
    const raw = formData.get("data");
    if (typeof raw !== "string") error(400, "Missing data field");
    const payload = problemTestcaseSetCreateSchema.parse(JSON.parse(raw));
    const result = await createProblemTestcaseSetRecord(actor, slug, payload);

    return { id: result.id, success: true };
  }
};
