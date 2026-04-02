import { json } from "@sveltejs/kit";
import { prisma } from "@nojv/db";

import type { RequestHandler } from "./$types";

import { ForbiddenError, NotFoundError, requireApiAuth } from "$lib/server/auth";
import { resolveCoursePermission } from "$lib/server/auth";
import { canManageCourse } from "$lib/server/shared/permissions";
import { apiHandler } from "$lib/server/shared/api-handler";
import { plagiarismTargetFilter, type PlagiarismTarget } from "$lib/server/moss/service";
import { getTemporalClient, PLATFORM_TASK_QUEUE } from "@nojv/temporal";
import type { PlagiarismCheckInput } from "@nojv/temporal";

/**
 * Resolve the plagiarism target (course assessment or contest) from the assessmentId param
 * and the optional `type` query parameter. Defaults to "courseAssessment" for backward compat.
 */
async function resolvePlagiarismTarget(
  assessmentId: string,
  type: string | null
): Promise<{ target: PlagiarismTarget; courseSlug: string }> {
  if (type === "contest") {
    const contest = await prisma.contest.findUnique({
      where: { id: assessmentId },
      select: { course: { select: { slug: true } }, courseId: true, id: true }
    });

    if (!contest) {
      throw new NotFoundError("Contest not found.");
    }

    if (!contest.courseId || !contest.course) {
      throw new ForbiddenError(
        "Plagiarism checks are only available for course-linked contests."
      );
    }

    return { courseSlug: contest.course.slug, target: { id: contest.id, type: "contest" } };
  }

  // Default: courseAssessment
  const assessment = await prisma.courseAssessment.findUnique({
    where: { id: assessmentId },
    include: { course: { select: { slug: true } } }
  });

  if (!assessment) {
    throw new NotFoundError("Assessment not found.");
  }

  return {
    courseSlug: assessment.course.slug,
    target: { id: assessment.id, type: "courseAssessment" }
  };
}

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const assessmentId = event.params.assessmentId;
  const type = event.url.searchParams.get("type");

  const { courseSlug, target } = await resolvePlagiarismTarget(assessmentId, type);
  const { role } = await resolveCoursePermission(prisma, courseSlug, actor);

  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("Only course staff can trigger plagiarism checks.");
  }

  const report = await prisma.plagiarismReport.create({
    data: {
      ...(target.type === "courseAssessment" ? { courseAssessmentId: target.id } : { contestId: target.id }),
      status: "pending",
      triggeredById: actor.userId
    }
  });

  const client = await getTemporalClient();
  const workflowInput: PlagiarismCheckInput = {
    reportId: report.id,
    targetId: target.id,
    targetType: target.type,
    triggeredById: actor.userId
  };

  await client.workflow.start("plagiarismCheckWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `plagiarism-${report.id}`,
    args: [workflowInput]
  });

  return json({ reportId: report.id, status: "pending" }, { status: 202 });
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const assessmentId = event.params.assessmentId;
  const type = event.url.searchParams.get("type");

  const { courseSlug, target } = await resolvePlagiarismTarget(assessmentId, type);
  const { role } = await resolveCoursePermission(prisma, courseSlug, actor);

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
        ...plagiarismTargetFilter(target),
        problemId,
        userId
      },
      orderBy: { score: "desc" },
      select: { sourceCode: true }
    });

    return json({ sourceCode: submission?.sourceCode ?? null });
  }

  const reports = await prisma.plagiarismReport.findMany({
    where: plagiarismTargetFilter(target),
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
