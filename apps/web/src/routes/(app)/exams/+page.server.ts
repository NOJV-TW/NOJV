import type { PageServerLoad } from "./$types";
import { createAssessmentListLoader } from "$lib/server/course/queries";
import { listPublicContests } from "$lib/server/contest/queries";

const loadAssessments = createAssessmentListLoader("exam");

export const load: PageServerLoad = async (event) => {
  const [assessmentData, contests] = await Promise.all([
    loadAssessments(event),
    listPublicContests()
  ]);

  return {
    ...assessmentData,
    contests
  };
};
