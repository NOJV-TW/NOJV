import type { PageServerLoad } from "./$types";
import { createAssessmentDetailLoader } from "$lib/server/course/queries";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(createAssessmentDetailLoader());
