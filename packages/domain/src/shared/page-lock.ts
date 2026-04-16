import { contestRepo, examRepo } from "@nojv/db";

export type PageLockedContext =
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string };

/**
 * Returns the single proctored entity the user is currently locked into
 * (if any). Exam wins over contest when both apply — matches the design
 * invariant that a user has at most one active proctored session.
 */
export async function getPageLockedContext(userId: string): Promise<PageLockedContext | null> {
  const now = new Date();

  const exam = await examRepo.findPageLockedForUser(userId, now);
  if (exam) {
    return { type: "exam", examId: exam.id };
  }

  const contest = await contestRepo.findPageLockedForUser(userId, now);
  if (contest) {
    return { type: "contest", contestId: contest.id };
  }

  return null;
}
