import { error, redirect } from "@sveltejs/kit";
import { prisma } from "@nojv/db";
import { problemUpdateSchema, problemTemplateSchema } from "@nojv/core";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import { updateProblemRecord, replaceTemplates, createProblemTestcaseSetRecord } from "$lib/server/db";
import { getProblemPageData } from "$lib/server/queries";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(302, `/problems/${params.slug}`);
  }

  const problem = await getProblemPageData(params.slug);

  if (!problem) {
    error(404, "Problem not found");
  }

  return { problem };
};

const updateTemplatesSchema = z.array(problemTemplateSchema).max(10);

export const actions: Actions = {
  update: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const formData = await event.request.formData();
    const payload = problemUpdateSchema.parse(JSON.parse(formData.get("data") as string));
    const result = await updateProblemRecord(actor, slug, payload);

    return { id: result.id, success: true };
  },

  updateTemplates: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const formData = await event.request.formData();
    const templates = updateTemplatesSchema.parse(JSON.parse(formData.get("data") as string));

    const result = await prisma.$transaction(async (tx) => {
      const problem = await tx.problem.findUnique({ where: { slug } });

      if (!problem) {
        throw new NotFoundError(`Problem not found: ${slug}`);
      }

      if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
        throw new ForbiddenError("Only the author or an admin can update templates.");
      }

      await replaceTemplates(tx, problem.id, templates);

      return tx.problemTemplate.findMany({
        orderBy: { language: "asc" },
        where: { problemId: problem.id }
      });
    });

    return { success: true, templates: result };
  },

  createTestcaseSet: async (event) => {
    const actor = await requireAuth(event);
    const slug = event.params.slug;
    const formData = await event.request.formData();
    const payload = JSON.parse(formData.get("data") as string);
    const result = await createProblemTestcaseSetRecord(actor, slug, payload);

    return { id: result.id, success: true };
  }
};
