import { durableWorkRepo, Prisma, type TransactionClient } from "@nojv/db";
import type { ActivityProblem } from "@nojv/core";
import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ValidationError } from "../shared/errors";
import { resolveActivityProblems } from "../problem/fork";
import { assertProblemHasWorkspaceForLanguages } from "../problem/permissions";
import { assertActivityAllocation } from "./activity-points";
import type { Language } from "@nojv/core";

export async function saveActivityGrading(
  tx: TransactionClient,
  actor: ActorContext,
  input: {
    type: "assignment" | "exam";
    id: string;
    totalPoints: number;
    problems: ActivityProblem[];
    published: boolean;
    allowedLanguages: Language[];
    expectedRevision?: number | undefined;
  },
) {
  const isExam = input.type === "exam";
  const current = isExam
    ? await tx.exam.findUniqueOrThrow({
        where: { id: input.id },
        include: { problems: { orderBy: { ordinal: "asc" } } },
      })
    : await tx.assessment.findUniqueOrThrow({
        where: { id: input.id },
        include: { problems: { orderBy: { ordinal: "asc" } } },
      });
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== current.gradingRevision
  ) {
    throw new ConflictError("The grading configuration changed. Reload before saving.");
  }
  assertActivityAllocation(input.totalPoints, input.problems, input.published);
  const before = {
    totalPoints: Number(current.totalPoints),
    problems: current.problems.map((p) => ({
      problemId: p.problemId,
      points: Number(p.points),
    })),
  };
  if (
    JSON.stringify(before) ===
    JSON.stringify({ totalPoints: input.totalPoints, problems: input.problems })
  )
    return { totalPoints: current.totalPoints, gradingRevision: current.gradingRevision };
  const knownIds = new Set([
    ...current.problems.map((p) => p.problemId),
    ...current.detachedProblemIds,
  ]);
  const selected = await resolveActivityProblems(
    tx,
    actor,
    input.problems.map(({ problemId }) => problemId),
    { courseId: current.courseId, existingProblemIds: [...knownIds] },
  );
  const resolved: ActivityProblem[] = [];
  for (const [index, entry] of input.problems.entries()) {
    const problem = selected[index];
    if (!problem) throw new ValidationError("Problem could not be attached.");
    if (!knownIds.has(entry.problemId) && input.allowedLanguages.length) {
      await assertProblemHasWorkspaceForLanguages(tx, problem.id, input.allowedLanguages);
    }
    resolved.push({ problemId: problem.id, points: entry.points });
  }
  const ids = resolved.map((p) => p.problemId);
  if (isExam) {
    await tx.examProblem.deleteMany({ where: { examId: input.id, problemId: { notIn: ids } } });
    await tx.examProblem.updateMany({
      where: { examId: input.id },
      data: { ordinal: { increment: 1000 } },
    });
  } else {
    await tx.assessmentProblem.deleteMany({
      where: { assessmentId: input.id, problemId: { notIn: ids } },
    });
    await tx.assessmentProblem.updateMany({
      where: { assessmentId: input.id },
      data: { ordinal: { increment: 1000 } },
    });
  }
  for (const [index, entry] of resolved.entries()) {
    const data = { points: new Prisma.Decimal(entry.points), ordinal: index + 1 };
    if (isExam)
      await tx.examProblem.upsert({
        where: { examId_problemId: { examId: input.id, problemId: entry.problemId } },
        create: { examId: input.id, problemId: entry.problemId, ...data },
        update: data,
      });
    else
      await tx.assessmentProblem.upsert({
        where: {
          assessmentId_problemId: { assessmentId: input.id, problemId: entry.problemId },
        },
        create: { assessmentId: input.id, problemId: entry.problemId, ...data },
        update: data,
      });
  }
  const revision = current.gradingRevision + 1;
  const data = {
    totalPoints: input.totalPoints,
    gradingRevision: revision,
    detachedProblemIds: [...knownIds].filter((id) => !ids.includes(id)),
  };
  if (isExam) await tx.exam.update({ where: { id: input.id }, data });
  else await tx.assessment.update({ where: { id: input.id }, data });
  if (isExam) {
    const participants = await tx.participation.findMany({
      where: { type: "exam", examId: input.id },
      select: { userId: true },
    });
    for (const p of participants)
      await durableWorkRepo.withTx(tx).enqueue({
        kind: "score.converge",
        dedupeKey: `exam-grading:${input.id}:${String(revision)}:${p.userId}`,
        payload: { context: { type: "exam", examId: input.id }, userId: p.userId },
      });
  }
  return { totalPoints: new Prisma.Decimal(input.totalPoints), gradingRevision: revision };
}
