import type { PageServerLoad } from "./$types";
import { createAssessmentDetailLoader } from "$lib/server/queries";

export const load: PageServerLoad = createAssessmentDetailLoader("assignment");
