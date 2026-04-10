import { ipViolationLogRepo } from "@nojv/db";

/**
 * List IP violation logs for a contest (admin/teacher view). Homework
 * assessments no longer have IP lock, so there is no assessment branch.
 */
export function listContestIpViolations(opts: { contestId: string; take?: number }) {
  return ipViolationLogRepo.listByContest({
    contestId: opts.contestId,
    take: opts.take ?? 200
  });
}
