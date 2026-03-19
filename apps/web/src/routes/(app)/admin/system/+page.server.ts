import { Queue, Job } from "bullmq";
import { parseRedisConnection, queueNames } from "@nojv/core";
import { prisma } from "@nojv/db";
import { fail } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { requireAuth } from "$lib/server/auth";

const envSchema = z.object({
  REDIS_URL: z.url()
});

const jobStatuses = ["waiting", "active", "completed", "failed", "delayed"] as const;
type JobStatus = (typeof jobStatuses)[number];

async function withQueue<T>(fn: (queue: Queue) => Promise<T>): Promise<T> {
  const env = envSchema.parse(process.env);
  const connection = parseRedisConnection(env.REDIS_URL);
  const queue = new Queue(queueNames.submission, { connection });
  try {
    return await fn(queue);
  } finally {
    await queue.close();
  }
}

function serializeJob(job: Job) {
  return {
    id: job.id,
    name: job.name,
    data: job.data as Record<string, unknown>,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn
  };
}

export const load: PageServerLoad = async ({ url }) => {
  const jobStatusParam = url.searchParams.get("jobStatus") ?? "failed";
  const jobStatus: JobStatus = jobStatuses.includes(jobStatusParam as JobStatus)
    ? (jobStatusParam as JobStatus)
    : "failed";

  // Queue status + jobs
  let queueCounts: Record<string, number> | null = null;
  let queueError: string | null = null;
  let queueJobs: ReturnType<typeof serializeJob>[] = [];

  try {
    await withQueue(async (queue) => {
      queueCounts = await queue.getJobCounts();
      const jobs = await queue.getJobs([jobStatus], 0, 49);
      queueJobs = jobs.map(serializeJob);
    });
  } catch (err) {
    queueError = err instanceof Error ? err.message : "Failed to connect to queue.";
  }

  // DB connection check
  let dbOk = false;
  let dbError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database connection failed.";
  }

  // Recent failed submissions
  const failedSubmissions = await prisma.submission.findMany({
    where: {
      status: { in: ["compile_error", "runtime_error"] }
    },
    select: {
      id: true,
      status: true,
      language: true,
      createdAt: true,
      user: { select: { username: true, name: true } },
      problem: { select: { slug: true, defaultTitle: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return {
    queueCounts,
    queueError,
    queueJobs,
    jobStatus,
    dbOk,
    dbError,
    failedSubmissions
  };
};

export const actions = {
  retryJob: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const jobId = formData.get("jobId") as string | null;
    if (!jobId) return fail(400, { error: "jobId is required." });

    try {
      await withQueue(async (queue) => {
        const job = await Job.fromId(queue, jobId);
        if (!job) return fail(404, { error: "Job not found." });
        await job.retry();
      });
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to retry job." });
    }

    return { success: true };
  },

  removeJob: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const jobId = formData.get("jobId") as string | null;
    if (!jobId) return fail(400, { error: "jobId is required." });

    try {
      await withQueue(async (queue) => {
        const job = await Job.fromId(queue, jobId);
        if (!job) return fail(404, { error: "Job not found." });
        await job.remove();
      });
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to remove job." });
    }

    return { success: true };
  },

  cleanJobs: async (event) => {
    const actor = requireAuth(event);
    if (actor.platformRole !== "admin") return fail(403, { error: "Forbidden" });

    const formData = await event.request.formData();
    const status = formData.get("status") as string | null;
    if (!status || !jobStatuses.includes(status as JobStatus)) {
      return fail(400, { error: "Valid status is required." });
    }

    try {
      await withQueue(async (queue) => {
        await queue.clean(0, 1000, status as JobStatus);
      });
    } catch (err) {
      return fail(500, { error: err instanceof Error ? err.message : "Failed to clean jobs." });
    }

    return { success: true };
  }
} satisfies Actions;
