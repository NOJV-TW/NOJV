import type { PageServerLoad } from "./$types";
import { createAssessmentDetailLoader } from "$lib/server/course/queries";

export const load: PageServerLoad = createAssessmentDetailLoader("assignment");
