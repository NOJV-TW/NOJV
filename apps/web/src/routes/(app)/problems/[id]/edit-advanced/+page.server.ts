import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { problemImageSourceSchema } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth, type CompletedActorContext } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { parseJsonField } from "$lib/server/shared/form-utils";
import { problemDomain } from "@nojv/domain";

const { getProblemPageData, updateProblemRecord } = problemDomain;

// Save payload: the image ref + source plus the three columns that used
// to live inside `advancedResourceLimits` on the problem row and are now
// direct Problem columns.
const advancedImageSavePayloadSchema = z.object({
  source: problemImageSourceSchema,
  ref: z.string().min(1).max(500),
  timeLimitMs: z.coerce.number().int().min(1_000).max(300_000).optional(),
  memoryLimitMb: z.coerce.number().int().min(16).max(4_096).optional()
});

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.id}`);
  }

  const problem = await getProblemPageData(params.id);

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
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb
    }
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
        ...(data.memoryLimitMb !== undefined ? { memoryLimitMb: data.memoryLimitMb } : {})
      });
    } catch (err) {
      return fail(400, { message: err instanceof Error ? err.message : "Update failed" });
    }
    return { success: true };
  })
};
