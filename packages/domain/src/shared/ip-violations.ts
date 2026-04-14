import { ipViolationLogRepo } from "@nojv/db";

/**
 * List IP violation logs for an exam (admin/teacher view). Standalone
 * contests and homework assessments do not have IP lock.
 */
export function listExamIpViolations(opts: { examId: string; take?: number }) {
  return ipViolationLogRepo.listByExam({
    examId: opts.examId,
    take: opts.take ?? 200
  });
}
