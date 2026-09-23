import { assertCanViewScoreOverrides } from "../score-override/permissions";
import type { ActorContext } from "../shared/actor-context";
import { gradingRepo, problemRepo } from "@nojv/db";
import type {
  ProblemDifficulty,
  ProblemStatus,
  ProblemType,
  ProblemVisibility,
  JudgeType,
} from "@nojv/core";
import { parsePersistedJudgeConfig } from "./judge-config";

export interface ProblemPickerCandidate {
  difficulty: ProblemDifficulty;
  displayId: number | null;
  id: string;
  judgeType: JudgeType;
  status: ProblemStatus;
  tags: string[];
  title: string;
  type: ProblemType;
  visibility: ProblemVisibility;
}

export function mapProblemPickerCandidate(problem: {
  difficulty: ProblemDifficulty;
  displayId: number | null;
  id: string;
  judgeConfig: unknown;
  status: ProblemStatus;
  tags: string[];
  title: string;
  type: ProblemType;
  visibility: ProblemVisibility;
}): ProblemPickerCandidate {
  const judgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
  return {
    difficulty: problem.difficulty,
    displayId: problem.displayId,
    id: problem.id,
    judgeType: judgeConfig.type,
    type: problem.type,
    status: problem.status,
    tags: problem.tags,
    title: problem.title,
    visibility: problem.visibility,
  };
}

export async function listEditableProblems(userId: string, sort: "asc" | "desc" = "asc") {
  const problems = await problemRepo.listEditable(userId, sort);
  return problems.map(mapProblemPickerCandidate);
}

export interface ProblemPickerGroups {
  personalProblems: ProblemPickerCandidate[];
  publicProblems: ProblemPickerCandidate[];
  courseProblems?: ProblemPickerCandidate[];
}

export async function listProblemPickerGroups(
  userId: string,
  sort: "asc" | "desc" = "asc",
): Promise<ProblemPickerGroups> {
  const [publicProblems, editableProblems] = await Promise.all([
    problemRepo.listPublicPicker(sort),
    problemRepo.listEditable(userId, sort),
  ]);

  return {
    personalProblems: editableProblems
      .filter((problem) => problem.status === "published")
      .map(mapProblemPickerCandidate),
    publicProblems: publicProblems.map(mapProblemPickerCandidate),
  };
}

export async function listActivityCandidateProblems(userId: string) {
  const problems = await problemRepo.listActivityCandidates(userId);
  return problems.map(mapProblemPickerCandidate);
}

export async function listActivityProblemPickerGroups(
  actor: ActorContext,
  context: { type: "assignment"; assignmentId: string } | { type: "exam"; examId: string },
): Promise<ProblemPickerGroups> {
  await assertCanViewScoreOverrides(actor, context);
  const id = context.type === "exam" ? context.examId : context.assignmentId;
  const [groups, ids] = await Promise.all([
    listProblemPickerGroups(actor.userId),
    gradingRepo.listDetachedProblemIds(context.type, id),
  ]);
  const detached = await problemRepo.listPickerByIds(ids);
  const personal = new Map(groups.personalProblems.map((p) => [p.id, p]));
  for (const problem of detached) personal.set(problem.id, mapProblemPickerCandidate(problem));
  return { ...groups, personalProblems: [...personal.values()] };
}
