import { examRepo } from "@nojv/db";

export interface PageLockedContext {
  type: "exam";
  examId: string;
}

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
