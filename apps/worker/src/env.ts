import { z } from "zod";

export const workerEnvSchema = z.object({
  EXECUTION_BACKEND: z.enum(["docker", "kubernetes"]),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535),
  REDIS_URL: z.url(),
  // Docker executor settings
  SANDBOX_CPU_LIMIT: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/),
  SANDBOX_IMAGE: z.string().trim().min(1),
  SANDBOX_MEMORY_MB: z.coerce.number().int().min(128).max(4096),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(512),
  // K8s executor settings (required only when EXECUTION_BACKEND=kubernetes)
  K8S_NAMESPACE: z.string().trim().min(1).optional(),
  K8S_CPU_REQUEST: z.string().trim().optional(),
  K8S_CPU_LIMIT: z.string().trim().optional(),
  K8S_MEMORY_REQUEST: z.string().trim().optional(),
  K8S_MEMORY_LIMIT: z.string().trim().optional(),
  // Worker settings
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64)
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: Record<string, string | undefined>): WorkerEnv {
  return workerEnvSchema.parse(input);
}
