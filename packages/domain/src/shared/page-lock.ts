import { examRepo } from "@nojv/db";

export interface PageLockedContext {
  examId: string;
}

export async function getPageLockedContext(userId: string): Promise<PageLockedContext | null> {
  const exam = await examRepo.findPageLockedForUser(userId, new Date());
  return exam ? { examId: exam.id } : null;
}
