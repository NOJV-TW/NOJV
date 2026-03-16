import type { RequestHandler } from "@sveltejs/kit";
import { prisma } from "@nojv/db";

import {
  requireApiAuth,
  ForbiddenError,
  NotFoundError,
  getCoursePermissionRole,
  isCourseStaff
} from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { DEFAULT_LOCALE } from "$lib/utils";
import { pickProblemStatement } from "$lib/server/shared/pick-problem-statement";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { slug } = event.params;
  if (!slug) throw new NotFoundError("Course not found.");

  // Permission check: teacher/ta/admin only
  const role = await getCoursePermissionRole(slug, actor);
  if (!role || !isCourseStaff(role)) {
    throw new ForbiddenError("You do not have permission to export grades.");
  }

  const assessmentSlug = event.url.searchParams.get("assessment");
  if (!assessmentSlug) {
    return new Response(JSON.stringify({ message: "Missing assessment query parameter." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Find course
  const course = await prisma.course.findUnique({
    where: { slug },
    select: { id: true }
  });
  if (!course) throw new NotFoundError("Course not found.");

  // Find assessment
  const assessment = await prisma.courseAssessment.findFirst({
    where: { courseId: course.id, slug: assessmentSlug, status: "published" },
    select: {
      id: true,
      problems: {
        select: {
          problemId: true,
          problem: { select: { id: true, slug: true, summary: true, statements: true } }
        },
        orderBy: { ordinal: "asc" }
      }
    }
  });
  if (!assessment) throw new NotFoundError("Assessment not found.");

  // Get problem titles
  const problems = assessment.problems.map((p) => {
    const localized = pickProblemStatement(
      p.problem.statements,
      DEFAULT_LOCALE,
      p.problem.slug,
      p.problem.summary
    );
    return { problemId: p.problem.id, title: localized.title };
  });

  // Get active students
  const memberships = await prisma.courseMembership.findMany({
    where: { courseId: course.id, role: "student", status: "active" },
    select: {
      userId: true,
      user: { select: { username: true, name: true } }
    },
    orderBy: { user: { username: "asc" } }
  });

  const students = memberships.map((m) => ({
    userId: m.userId,
    username: m.user.username ?? m.user.name,
    name: m.user.name
  }));

  // Get best scores via groupBy
  const problemIds = problems.map((p) => p.problemId);
  const studentIds = students.map((s) => s.userId);

  const grouped =
    studentIds.length > 0 && problemIds.length > 0
      ? await prisma.submission.groupBy({
          by: ["userId", "problemId"],
          _max: { score: true },
          where: {
            courseAssessmentId: assessment.id,
            sampleOnly: false,
            userId: { in: studentIds },
            problemId: { in: problemIds }
          }
        })
      : [];

  // Build score lookup: `userId:problemId` -> best score
  const scoreLookup = new Map<string, number>();
  for (const row of grouped) {
    scoreLookup.set(`${row.userId}:${row.problemId}`, row._max.score ?? 0);
  }

  // Generate CSV
  const headers = ["Name", "Username", ...problems.map((p) => p.title), "Total"];
  const rows: string[] = [headers.map(escapeCsvField).join(",")];

  for (const student of students) {
    let total = 0;
    const scores: string[] = [];
    for (const problem of problems) {
      const score = scoreLookup.get(`${student.userId}:${problem.problemId}`) ?? 0;
      total += score;
      scores.push(String(score));
    }
    const row = [
      escapeCsvField(student.name),
      escapeCsvField(student.username),
      ...scores,
      String(total)
    ];
    rows.push(row.join(","));
  }

  const csv = "\uFEFF" + rows.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="progress-${assessmentSlug}.csv"`
    }
  });
});
