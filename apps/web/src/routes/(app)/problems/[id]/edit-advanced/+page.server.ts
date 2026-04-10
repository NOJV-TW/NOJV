import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { advancedImageConfigSchema, advancedResourceLimitsSchema } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth, type CompletedActorContext } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { parseJsonField } from "$lib/server/shared/form-utils";
import { problemDomain } from "@nojv/domain";
import { advancedTestcaseRepo } from "@nojv/db";

const { getProblemPageData, updateProblemRecord, replaceAdvancedTestcases } = problemDomain;

const advancedCaseSchema = z.object({
  stdin: z.string().max(200_000),
  expected: z.string().max(200_000),
  files: z.record(z.string().max(300), z.string().max(2_000_000))
});

const advancedTestcasesPayloadSchema = z.array(advancedCaseSchema).max(256);

// Extended image config: optional resource limits on the save payload.
const advancedImageSavePayloadSchema = advancedImageConfigSchema.extend({
  resourceLimits: advancedResourceLimitsSchema.optional()
});

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.id}`);
  }

  const problem = await getProblemPageData(params.id);
  if (!problem) {
    error(404, "Problem not found");
  }

  if (problem.mode !== "advanced") {
    redirect(302, `/problems/${params.id}/edit`);
  }

  const existingCases = await advancedTestcaseRepo.findByProblemId(params.id);

  return {
    problem,
    imageConfig: {
      source: problem.advancedImageSource ?? "registry",
      ref: problem.advancedImageRef ?? "",
      resourceLimits: problem.advancedResourceLimits ?? {
        totalTimeMs: 30_000,
        memoryMb: 1_024,
        networkEnabled: false
      }
    },
    advancedCases: existingCases.map((c) => ({
      stdin: c.stdin,
      expected: c.expected,
      files: (c.files ?? {}) as Record<string, string>
    }))
  };
};

function advancedAction<T>(
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

export const actions: Actions = {
  updateImage: advancedAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), advancedImageSavePayloadSchema);
    try {
      await updateProblemRecord(actor, problemId, {
        mode: "advanced",
        advancedImageRef: data.ref,
        advancedImageSource: data.source,
        ...(data.resourceLimits ? { advancedResourceLimits: data.resourceLimits } : {})
      });
    } catch (err) {
      return fail(400, { message: err instanceof Error ? err.message : "Update failed" });
    }
    return { success: true };
  }),

  updateAdvancedTestcases: advancedAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), advancedTestcasesPayloadSchema);
    try {
      const result = await replaceAdvancedTestcases(actor, problemId, data);
      return { success: true, count: result.count };
    } catch (err) {
      return fail(400, { message: err instanceof Error ? err.message : "Save failed" });
    }
  })
};
