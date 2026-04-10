import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { problemImageSourceSchema } from "@nojv/core";
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

// Save payload: the image ref + source plus the three columns that used
// to live inside `advancedResourceLimits` on the problem row and are now
// direct Problem columns.
const advancedImageSavePayloadSchema = z.object({
  source: problemImageSourceSchema,
  ref: z.string().min(1).max(500),
  timeLimitMs: z.coerce.number().int().min(1_000).max(300_000).optional(),
  memoryLimitMb: z.coerce.number().int().min(16).max(4_096).optional(),
  networkEnabled: z.boolean().optional()
});

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.id}`);
  }

  // Both queries only depend on params.id — fire in parallel.
  const [problem, existingCases] = await Promise.all([
    getProblemPageData(params.id),
    advancedTestcaseRepo.findByProblemId(params.id)
  ]);

  if (!problem) {
    error(404, "Problem not found");
  }

  if (problem.type !== "special_env") {
    redirect(302, `/problems/${params.id}/edit`);
  }

  return {
    problem,
    imageConfig: {
      source: problem.advancedImageSource ?? "registry",
      ref: problem.advancedImageRef ?? "",
      // Resource limits live directly on Problem now: `timeLimitMs` is
      // the total-per-invocation for the TA image, `memoryLimitMb` is
      // its memory ceiling, and `networkEnabled` is the single switch.
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      networkEnabled: problem.networkEnabled
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
        type: "special_env",
        advancedImageRef: data.ref,
        advancedImageSource: data.source,
        ...(data.timeLimitMs !== undefined ? { timeLimitMs: data.timeLimitMs } : {}),
        ...(data.memoryLimitMb !== undefined ? { memoryLimitMb: data.memoryLimitMb } : {}),
        ...(data.networkEnabled !== undefined ? { networkEnabled: data.networkEnabled } : {})
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
