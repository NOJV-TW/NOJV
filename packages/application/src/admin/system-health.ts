import { submissionRepo, userRepo } from "@nojv/db";
import { getRedis } from "@nojv/redis";

import { getDomainOrchestration } from "../shared/orchestration";
import { getSubmissionPendingTimeoutMinutes } from "../submission/sweep";

export type HealthStatus = "ok" | "down";

export interface SystemHealthReport {
  database: HealthStatus;
  redis: HealthStatus;
  temporal: HealthStatus;
  pendingJudging: number | null;
  staleJudging: number | null;
}

const JUDGING_STATUSES = ["queued", "compiling", "running"] as const;

async function probe(check: () => Promise<unknown>): Promise<HealthStatus> {
  try {
    await check();
    return "ok";
  } catch {
    return "down";
  }
}

export async function getSystemHealth(): Promise<SystemHealthReport> {
  const cutoff = new Date(Date.now() - getSubmissionPendingTimeoutMinutes() * 60_000);

  const [database, redis, temporal, pendingJudging, staleJudging] = await Promise.all([
    probe(() => userRepo.count({})),
    probe(() => getRedis().ping()),
    probe(() => getDomainOrchestration().probeTemporal()),
    submissionRepo.count({ status: { in: [...JUDGING_STATUSES] } }).catch((error: unknown) => {
      console.error("Failed to count pending submissions", error);
      return null;
    }),
    submissionRepo
      .count({ status: { in: [...JUDGING_STATUSES] }, createdAt: { lt: cutoff } })
      .catch((error: unknown) => {
        console.error("Failed to count stale submissions", error);
        return null;
      }),
  ]);

  return { database, redis, temporal, pendingJudging, staleJudging };
}
