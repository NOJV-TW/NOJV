import { problemTestcaseSetCreateSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { withAuth } from "$lib/server/api-handler";
import { createProblemTestcaseSetRecord } from "$lib/server/data-access/problems";

export const POST = withAuth(async (event, actor) => {
  const slug = event.params.slug;
  const payload = problemTestcaseSetCreateSchema.parse(await event.request.json());
  const result = await createProblemTestcaseSetRecord(actor, slug, payload);

  return json(result, { status: 201 });
});
