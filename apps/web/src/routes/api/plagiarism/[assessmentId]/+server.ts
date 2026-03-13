import { json } from "@sveltejs/kit";
import { prisma } from "@nojv/db";

import type { RequestHandler } from "./$types";

import { ForbiddenError, NotFoundError, requireApiAuth } from "$lib/server/auth";
import { resolveCoursePermission } from "$lib/server/auth";
import { canManageCourse } from "$lib/server/shared/permissions";
import { apiHandler } from "$lib/server/shared/api-handler";
import { triggerPlagiarismCheck } from "$lib/server/moss/service";

async function getAssessmentWithCourse(assessmentId: string) {
  const assessment = await prisma.courseAssessment.findUnique({
    where: { id: assessmentId },
    include: { course: { select: { slug: true } } }
  });

  if (!assessment) {
    throw new NotFoundError("Assessment not found.");
  }

  return assessment;
}

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { assessmentId } = event.params;

  const assessment = await getAssessmentWithCourse(assessmentId);
  const { role } = await resolveCoursePermission(prisma, assessment.course.slug, actor);

  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("Only course staff can trigger plagiarism checks.");
  }

  const reportId = await triggerPlagiarismCheck(assessmentId, actor.userId);

  return json({ reportId, status: "pending" }, { status: 202 });
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { assessmentId } = event.params;

  const assessment = await getAssessmentWithCourse(assessmentId);
  const { role } = await resolveCoursePermission(prisma, assessment.course.slug, actor);

  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("Only course staff can view plagiarism reports.");
  }

  // If source=true, return a specific submission's source code for comparison
  const source = event.url.searchParams.get("source");
  if (source === "true") {
    const userId = event.url.searchParams.get("userId");
    const problemId = event.url.searchParams.get("problemId");

    if (!userId || !problemId) {
      return json({ message: "userId and problemId are required." }, { status: 400 });
    }

    const submission = await prisma.submission.findFirst({
      where: {
        courseAssessmentId: assessmentId,
        problemId,
        userId
      },
      orderBy: { score: "desc" },
      select: { sourceCode: true }
    });

    return json({ sourceCode: submission?.sourceCode ?? null });
  }

  const reports = await prisma.plagiarismReport.findMany({
    where: { courseAssessmentId: assessmentId },
    orderBy: { createdAt: "desc" },
    select: {
      completedAt: true,
      createdAt: true,
      id: true,
      mossReportUrl: true,
      results: true,
      status: true
    }
  });

  return json({ reports });
});
