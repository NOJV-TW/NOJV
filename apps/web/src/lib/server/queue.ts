import { Queue } from "bullmq";
import { cheatingSignalSchema, type CheatingSignal } from "@nojv/domain";
import {
  createCheatingSignalJob,
  createSubmissionJob,
  defaultJobOptions,
  queueNames,
  submissionJudgeJobSchema,
  type SubmissionJudgeJob
} from "@nojv/queue";
import { z } from "zod";

const queueEnvSchema = z.object({
  REDIS_URL: z.url().default("redis://localhost:6379")
});

interface QueueRegistry {
  queues: {
    cheatingSignal: Queue<CheatingSignal>;
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
      cheatingSignal: new Queue(queueNames.cheatingSignal, { connection }),
      submission: new Queue(queueNames.submission, { connection })
    }
  };
}

function getQueueRegistry() {
  globalForQueues.__nojvQueueRegistry ??= createQueueRegistry();

  return globalForQueues.__nojvQueueRegistry;
}

export async function dispatchSubmissionJob(payload: SubmissionJudgeJob): Promise<void> {
  const jobEnvelope = createSubmissionJob(submissionJudgeJobSchema.parse(payload));
  const registry = getQueueRegistry();

  await registry.queues.submission.add(jobEnvelope.name, jobEnvelope.data, defaultJobOptions);
}

export async function bufferCheatingSignals(signals: CheatingSignal[]) {
  const payload = z.array(cheatingSignalSchema).min(1).parse(signals);
  const registry = getQueueRegistry();

  await Promise.all(
    payload.map((signal) => {
      const jobEnvelope = createCheatingSignalJob(signal);
      return registry.queues.cheatingSignal.add(
        jobEnvelope.name,
        jobEnvelope.data,
        defaultJobOptions
      );
    })
  );
}
