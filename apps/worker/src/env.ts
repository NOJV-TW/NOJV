import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535),
  REDIS_URL: z.url(),
  // Temporal settings
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  // Docker executor settings
  SANDBOX_CPU_LIMIT: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/),
  SANDBOX_IMAGE: z.string().trim().min(1),
  SANDBOX_MEMORY_MB: z.coerce.number().int().min(128).max(4096),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(512),
  // Worker settings
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64),
  WORKER_MODE: z.enum(["all", "judge", "platform"]).default("all")
});

const dockerEnvSchema = baseEnvSchema.extend({
  EXECUTION_BACKEND: z.literal("docker"),
  K8S_NAMESPACE: z.string().trim().min(1).optional(),
  K8S_CPU_REQUEST: z.string().trim().optional(),
  K8S_CPU_LIMIT: z.string().trim().optional(),
  K8S_MEMORY_REQUEST: z.string().trim().optional(),
  K8S_MEMORY_LIMIT: z.string().trim().optional()
});

const kubernetesEnvSchema = baseEnvSchema.extend({
  EXECUTION_BACKEND: z.literal("kubernetes"),
  K8S_NAMESPACE: z.string().trim().min(1),
  K8S_CPU_REQUEST: z.string().trim().min(1),
  K8S_CPU_LIMIT: z.string().trim().min(1),
  K8S_MEMORY_REQUEST: z.string().trim().min(1),
  K8S_MEMORY_LIMIT: z.string().trim().min(1)
});

export const workerEnvSchema = z.discriminatedUnion("EXECUTION_BACKEND", [
  dockerEnvSchema,
  kubernetesEnvSchema
]);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: Record<string, string | undefined>): WorkerEnv {
  return workerEnvSchema.parse(input);
}
