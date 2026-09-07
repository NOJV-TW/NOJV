import { z } from "zod";
import { courseDomain, problemDomain } from "@nojv/application";
import type { Actions, PageServerLoad, PageServerLoadEvent, RequestEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { withAction } from "$lib/server/shared/action-handlers";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const problemIdsSchema = z.array(z.string().trim().min(1)).min(1).max(100);
const problemIdSchema = z.string().trim().min(1);

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const library = await courseDomain.getCourseProblemLibrary(actor, event.params.courseId);
  const candidateProblems: problemDomain.ProblemPickerGroups = {
    personalProblems: [],
    publicProblems: [],
  };

  if (!library.course.archived) {
    const [editable, groups] = await Promise.all([
      problemDomain.listEditableProblems(actor.userId),
      problemDomain.listProblemPickerGroups(actor.userId),
    ]);
    candidateProblems.personalProblems = editable.filter(
      (problem) => problem.visibility === "private",
    );
    candidateProblems.publicProblems = groups.publicProblems;
  }

  return { library, candidateProblems };
});

export const actions = {
  add: withAction(async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const data = await event.request.formData();
    const problemIds = problemIdsSchema.parse(data.getAll("problemIds"));
    await courseDomain.addCourseProblems(actor, event.params.courseId, problemIds);
    return { added: true };
  }),
  remove: withAction(async (event: RequestEvent) => {
    const actor = requireAuth(event);
    const data = await event.request.formData();
    const problemId = problemIdSchema.parse(data.get("problemId"));
    await courseDomain.removeCourseProblem(actor, event.params.courseId, problemId);
    return { removed: true };
  }),
} satisfies Actions;
