import type { PageServerLoad } from "./$types";
import { createAssessmentListLoader } from "$lib/server/queries";

export const load: PageServerLoad = createAssessmentListLoader("assignment");
