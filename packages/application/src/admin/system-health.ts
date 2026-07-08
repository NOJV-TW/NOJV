import { submissionRepo, userRepo } from "@nojv/db";
import { getRedis } from "@nojv/redis";

import { getDomainOrchestration } from "../shared/orchestration";
import { getSubmissionPendingTimeoutMinutes } from "../submission/sweep";

export type HealthStatus = "ok" | "down";

export interface SystemHealthReport {
  database: HealthStatus;
  redis: HealthStatus;
  temporal: HealthStatus;
  pendingJudging: number;
  staleJudging: number;
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
    submissionRepo.count({ status: { in: [...JUDGING_STATUSES] } }).catch(() => 0),
    submissionRepo
      .count({ status: { in: [...JUDGING_STATUSES] }, createdAt: { lt: cutoff } })
      .catch(() => 0),
  ]);

  return { database, redis, temporal, pendingJudging, staleJudging };
}
