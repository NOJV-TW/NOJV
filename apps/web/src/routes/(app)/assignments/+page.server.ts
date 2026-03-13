import type { PageServerLoad } from "./$types";
import { createAssessmentListLoader } from "$lib/server/course/queries";

export const load: PageServerLoad = createAssessmentListLoader();
