import { examRepo } from "@nojv/db";

/**
 * Page-lock context for a user. Only exams can page-lock now —
 * standalone contests dropped proctoring as part of the 2026-04-14
 * split (Contest <-> Exam).
 */
export interface PageLockedContext {
  type: "exam";
  examId: string;
}

/**
 * Check if user is currently locked to an active exam. Returns the
 * locked context if found, null otherwise.
 */
export async function getPageLockedContext(userId: string): Promise<PageLockedContext | null> {
  const now = new Date();

  const exam = await examRepo.findPageLockedForUser(userId, now);

  if (exam) {
    return {
      type: "exam",
      examId: exam.id
    };
  }

  return null;
}
