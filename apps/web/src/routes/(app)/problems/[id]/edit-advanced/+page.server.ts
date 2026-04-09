import { error, fail, redirect, type RequestEvent } from "@sveltejs/kit";
import { z } from "zod";
import { advancedImageConfigSchema } from "@nojv/core";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth, type CompletedActorContext } from "$lib/server/auth";
import { consumeFormRateLimit } from "$lib/server/shared/rate-limiter";
import { problemDomain } from "@nojv/domain";

const { getProblemPageData, updateProblemRecord } = problemDomain;

/**
 * Phase 7 advanced-mode case shape used by AdvancedTestcasesSection. The
 * persistence layer stores these inside the problem's testcase set / sample
 * bag (TODO: full plumb-through wired up in Phase 8 once the storage layout
 * is finalized).
 */
const advancedCaseSchema = z.object({
  stdin: z.string().max(200_000),
  expected: z.string().max(200_000),
  files: z.record(z.string().max(300), z.string().max(2_000_000))
});

const advancedTestcasesPayloadSchema = z.array(advancedCaseSchema).max(256);

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

  return {
    problem,
    imageConfig: {
      source: problem.advancedImageSource ?? "registry",
      ref: problem.advancedImageRef ?? "",
      resourceLimits: {
        // TODO(phase-7-followup): persist resourceLimits per-problem instead
        // of falling back to defaults each load.
        totalTimeMs: 30_000,
        memoryMb: 1_024,
        networkEnabled: false
      }
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

export const actions: Actions = {
  updateImage: advancedAction(async ({ actor, problemId, event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), advancedImageConfigSchema);
    try {
      await updateProblemRecord(actor, problemId, {
        mode: "advanced",
        advancedImageRef: data.ref,
        advancedImageSource: data.source
      });
    } catch (err) {
      return fail(400, { message: err instanceof Error ? err.message : "Update failed" });
    }
    return { success: true };
  }),

  updateAdvancedTestcases: advancedAction(async ({ event }) => {
    const formData = await event.request.formData();
    const data = parseJsonField(formData.get("data"), advancedTestcasesPayloadSchema);
    // TODO(phase-7-followup): persist `data` to ProblemWorkspaceFile or a
    // dedicated AdvancedTestcase table once the storage layout is finalized
    // in Phase 8. For now we accept the payload so the UI flow is unblocked.
    return { success: true, count: data.length };
  })
};
