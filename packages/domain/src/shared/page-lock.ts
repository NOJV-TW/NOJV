import { examRepo } from "@nojv/db";

export interface PageLockedContext {
  examId: string;
}

/**
 * Returns the exam the user is currently locked into (if any). Only exams
 * carry page lock — contests are public CP events with no proctoring.
 */
export async function getPageLockedContext(userId: string): Promise<PageLockedContext | null> {
  const exam = await examRepo.findPageLockedForUser(userId, new Date());
  return exam ? { examId: exam.id } : null;
}
