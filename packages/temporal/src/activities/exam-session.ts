import { examDomain } from "@nojv/domain";

export async function closeActiveSessionsForExam(examId: string): Promise<{ closed: number }> {
  return examDomain.session.autoCloseForExam(examId);
}
