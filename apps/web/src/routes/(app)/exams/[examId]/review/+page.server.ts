import { error } from "@sveltejs/kit";
import { examDomain, NotFoundError } from "@nojv/domain";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getExamDetailPage, getExamSubmissionsMatrix } = examDomain;

export interface ReviewProblem {
  id: string;
  letter: string;
  title: string;
  /** Domain difficulty enum, casing-converted by the page. */
  difficulty: "easy" | "medium" | "hard";
  score: number;
  max: number;
  tries: number;
  verdict: "AC" | "PAC" | "WA" | "—";
}

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { exam: examHeader, isManager } = parent;
  const actor = requireAuth(event);
  const examId = event.params.examId;

  const detail = await getExamDetailPage(examId, {
    viewerUserId: actor.userId,
    isManager,
  });
  if (detail?.courseId !== examHeader.courseId) {
    throw new NotFoundError("Exam not found.");
  }

  // Review is only meaningful once the exam has ended.
  const now = Date.now();
  if (now < new Date(detail.endsAt).getTime() && detail.status !== "ended") {
    error(403, "Exam has not ended yet.");
  }

  // The submissions matrix is the cleanest available source for
  // per-problem score + attempt count. It's a manager-only domain
  // query but its read path is just an aggregate over published
  // submissions — safe to expose to the student-owner for their own
  // row only. We filter the matrix to just the viewer's row server-side.
  //
  // TODO(NOJV): build a dedicated `getExamStudentReview(examId, userId)`
  // domain query that also returns subtask breakdown + final
  // submission source code. The current implementation can't surface
  // either (matrix only has aggregate score) so the UI shows empty
  // subtask grid + a placeholder for the source.
  const matrix = await getExamSubmissionsMatrix(examId);
  const myRow = matrix.rows.find((r) => r.userId === actor.userId);

  const problemMap = new Map(detail.problems.map((p) => [p.id, p]));
  const problems: ReviewProblem[] = matrix.problems.map((col) => {
    const cell = myRow?.cells.find((c) => c.problemId === col.problemId);
    const meta = problemMap.get(col.problemId);
    const score = cell?.score ?? 0;
    const max = col.points;
    let verdict: ReviewProblem["verdict"] = "—";
    if (cell?.state === "ac") verdict = "AC";
    else if (cell?.state === "partial") verdict = "PAC";
    else if (cell?.state === "zero") verdict = "WA";
    return {
      id: col.problemId,
      letter: col.letter,
      title: col.title,
      difficulty: meta?.difficulty ?? "medium",
      score,
      max,
      tries: cell?.attempts ?? 0,
      verdict,
    };
  });

  const total = problems.reduce((s, p) => s + p.score, 0);
  const max = problems.reduce((s, p) => s + p.max, 0);

  return {
    examTitle: detail.title,
    examId: detail.id,
    examCode: `EX-${detail.id.slice(-6).toUpperCase()}`,
    problems,
    total,
    max,
  };
});
