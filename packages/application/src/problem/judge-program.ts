import type { JudgeProgramRole, JudgeScriptLanguage, SubmissionContext } from "@nojv/core";
import {
  assessmentProblemRepo,
  assessmentRepo,
  contestProblemRepo,
  contestRepo,
  courseRepo,
  examProblemRepo,
  examRepo,
  examSessionRepo,
  participationRepo,
  problemRepo,
} from "@nojv/db";
import { assertStorageObjectPointer, getVerifiedText } from "@nojv/storage";

import { canManageContest } from "../contest/permissions";
import { checkProctoringGate } from "../proctoring/gate";
import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { canManageCourse, getCourseRole } from "../shared/permissions";
import { storage } from "../shared/storage-singleton";
import { parsePersistedJudgeConfig } from "./judge-config";
import { assertProblemViewAccess } from "./permissions";

export interface JudgeProgramSourceView {
  role: JudgeProgramRole;
  language: JudgeScriptLanguage;
  source: string;
  sha256: string;
}

type ActiveExamSession = Awaited<ReturnType<typeof examSessionRepo.findActiveForUser>>;

async function contextIncludesProblem(
  actor: ActorContext,
  problemId: string,
  context: SubmissionContext,
  session: ActiveExamSession,
  clientIp: string,
  now: Date,
): Promise<boolean> {
  switch (context.type) {
    case "practice":
      return false;
    case "exam": {
      const [exam, inExam] = await Promise.all([
        examRepo.findById(context.examId),
        examProblemRepo.exists(context.examId, problemId),
      ]);
      if (!exam || !inExam) return false;
      if (canManageCourse(await getCourseRole(actor, exam.courseId))) return true;
      if (session?.examId !== exam.id) return false;
      const gate = await checkProctoringGate({
        entityKind: "exam",
        entityId: exam.id,
        userId: actor.userId,
        ip: clientIp,
        now,
      });
      return gate.ok;
    }
    case "assignment": {
      const [assessment, inAssessment, course] = await Promise.all([
        assessmentRepo.findByIdWithCourseId(context.assessmentId),
        assessmentProblemRepo.exists(context.assessmentId, problemId),
        courseRepo.findById(context.courseId),
      ]);
      if (assessment?.courseId !== context.courseId || !inAssessment || !course) return false;
      const role = await getCourseRole(actor, course.id);
      if (canManageCourse(role)) return true;
      return (
        role !== null &&
        assessment.status === "published" &&
        !course.archived &&
        now >= assessment.opensAt &&
        now <= assessment.closesAt
      );
    }
    case "contest": {
      const [contest, inContest] = await Promise.all([
        contestRepo.findById(context.contestId),
        contestProblemRepo.existsById(context.contestId, problemId),
      ]);
      if (contest?.visibility !== "published" || !inContest) return false;
      if (canManageContest(actor.userId, contest, actor.platformRole)) return true;
      return (
        now >= contest.startsAt &&
        now <= contest.endsAt &&
        Boolean(await participationRepo.findContestParticipation(contest.id, actor.userId))
      );
    }
    case "virtual": {
      const virtual = await participationRepo.findVirtualById(context.participationId);
      if (virtual?.userId !== actor.userId || virtual.contestId === null) return false;
      if (now >= virtual.endsAt) return false;
      const [contest, inContest] = await Promise.all([
        contestRepo.findById(virtual.contestId),
        contestProblemRepo.existsById(virtual.contestId, problemId),
      ]);
      return contest?.visibility === "published" && inContest;
    }
  }
}

export async function getJudgeProgramSource(
  actor: ActorContext,
  problemId: string,
  context: SubmissionContext,
  clientIp: string,
): Promise<JudgeProgramSourceView> {
  const now = new Date();
  const [problem, session] = await Promise.all([
    problemRepo.findById(problemId),
    examSessionRepo.findActiveForUser(actor.userId),
  ]);
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);

  const confined = session?.exam.pageLockEnabled === true && actor.platformRole !== "admin";
  if (confined && (context.type !== "exam" || context.examId !== session.examId)) {
    throw new ForbiddenError("You are in an active exam — use that exam context.");
  }
  const included = await contextIncludesProblem(
    actor,
    problem.id,
    context,
    session,
    clientIp,
    now,
  );
  if (confined && !included) throw new ForbiddenError("This problem is not part of the exam.");
  await assertProblemViewAccess(problem, actor, { contextIncludesProblem: included, now });

  const judgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
  if (problem.type === "special_env" || judgeConfig.type === "standard") {
    throw new NotFoundError("This problem has no checker or interactor.");
  }
  const role = judgeConfig.type === "checker" ? "checker" : "interactor";
  const language =
    role === "checker" ? judgeConfig.checkerLanguage : judgeConfig.interactorLanguage;
  const pointer = role === "checker" ? problem.checkerStorage : problem.interactorStorage;
  if (!language || pointer === null) {
    throw new NotFoundError(`This problem has no ${role} yet.`);
  }
  const verified = assertStorageObjectPointer(pointer);
  return {
    role,
    language,
    source: await getVerifiedText(storage(), verified),
    sha256: verified.sha256,
  };
}
