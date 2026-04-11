import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { plagiarismDomain } from "@nojv/domain";

const { listAssessmentPlagiarismReports, getAssessmentProblemMap } = plagiarismDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(
  async ({ params, parent }: PageServerLoadEvent) => {
    const { courseData } = await parent();

    const assessment = courseData.course.assessments.find(
      (a) => a.slug === params.assessmentSlug
    );

    if (!assessment) {
      error(404, "Assessment not found");
    }

    // Independent fetches — run in parallel to halve load latency.
    const [reports, problemMap] = await Promise.all([
      listAssessmentPlagiarismReports(assessment.id),
      getAssessmentProblemMap(assessment.id)
    ]);

    // Build a lookup of userId -> username/name for display
    const memberMap = new Map(
      courseData.course.members.map((m) => [
        m.userId,
        { displayName: m.displayName, username: m.username }
      ])
    );

    return {
      assessment: { id: assessment.id, slug: assessment.slug, title: assessment.title },
      courseSlug: params.slug,
      memberMap: Object.fromEntries(memberMap),
      problemMap,
      reports: reports.map((r) => ({
        ...r,
        completedAt: r.completedAt?.toISOString() ?? null,
        triggeredAt: r.triggeredAt?.toISOString() ?? null
      }))
    };
  }
);
