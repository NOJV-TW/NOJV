import type { RequestHandler } from "@sveltejs/kit";

import {
  requireApiAuth,
  ForbiddenError,
  NotFoundError,
  getCoursePermissionRole,
  isCourseStaff
} from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { courseDomain } from "@nojv/domain";

const { getExportData } = courseDomain;

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

  const { problems, students, scoreLookup } = await getExportData(slug, assessmentSlug);

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
