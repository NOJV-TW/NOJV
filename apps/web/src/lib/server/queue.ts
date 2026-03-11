import { Queue } from "bullmq";
import {
  defaultJobOptions,
  queueNames,
  submissionJudgeJobSchema,
  type SubmissionJudgeJob
} from "@nojv/core";
import { z } from "zod";

const queueEnvSchema = z.object({
  REDIS_URL: z.url().default("redis://localhost:6379")
});

interface QueueRegistry {
  queues: {
    submission: Queue<SubmissionJudgeJob>;
  };
}

const environment = queueEnvSchema.parse(process.env);
const redis = new URL(environment.REDIS_URL);
const connection = {
  host: redis.hostname,
  maxRetriesPerRequest: null,
  password: redis.password || undefined,
  port: Number(redis.port || "6379")
};

const globalForQueues = globalThis as typeof globalThis & {
  __nojvQueueRegistry?: QueueRegistry;
};

function createQueueRegistry(): QueueRegistry {
  return {
    queues: {
      submission: new Queue(queueNames.submission, { connection })
    }
  };
}

function getQueueRegistry() {
  globalForQueues.__nojvQueueRegistry ??= createQueueRegistry();

  return globalForQueues.__nojvQueueRegistry;
}

export async function dispatchSubmissionJob(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const registry = getQueueRegistry();

  await registry.queues.submission.add(queueNames.submission, validated, defaultJobOptions);
}
