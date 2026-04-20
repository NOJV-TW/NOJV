import { ipViolationLogRepo } from "@nojv/db";

export function listExamIpViolations(opts: { examId: string; take?: number }) {
  return ipViolationLogRepo.listByExam({
    examId: opts.examId,
    take: opts.take ?? 200,
  });
}
