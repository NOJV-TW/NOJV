import { Queue } from "bullmq";
import { parseRedisConnection, queueNames } from "@nojv/core";
import { prisma } from "@nojv/db";
import { z } from "zod";
import type { PageServerLoad } from "./$types";

const envSchema = z.object({
  REDIS_URL: z.url()
});

export const load: PageServerLoad = async () => {
  // Queue status
  let queueCounts: Record<string, number> | null = null;
  let queueError: string | null = null;

  try {
    const env = envSchema.parse(process.env);
    const connection = parseRedisConnection(env.REDIS_URL);
    const queue = new Queue(queueNames.submission, { connection });
    queueCounts = await queue.getJobCounts();
    await queue.close();
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
    dbOk,
    dbError,
    failedSubmissions
  };
};
