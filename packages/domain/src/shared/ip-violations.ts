import { ipViolationLogRepo } from "@nojv/db";

/**
 * List IP violation logs for a contest or assessment (admin/teacher view).
 */
export function listIpViolations(opts: {
  contestId?: string;
  assessmentId?: string;
  take?: number;
}) {
  return ipViolationLogRepo.listByTarget({
    ...(opts.contestId ? { contestId: opts.contestId } : {}),
    ...(opts.assessmentId ? { assessmentId: opts.assessmentId } : {}),
    take: opts.take ?? 200
  });
}
