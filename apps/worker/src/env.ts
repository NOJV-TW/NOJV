import { z } from "zod";

export const workerEnvSchema = z.object({
  EXECUTION_BACKEND: z.enum(["docker", "kubernetes"]).default("docker"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  // Docker executor settings
  SANDBOX_CPU_LIMIT: z.string().trim().regex(/^\d+(\.\d+)?$/).default("1"),
  SANDBOX_IMAGE: z.string().trim().min(1).default("nojv-sandbox:local"),
  SANDBOX_MEMORY_MB: z.coerce.number().int().min(128).max(4096).default(256),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(512).default(64),
  // K8s executor settings
  K8S_NAMESPACE: z.string().trim().min(1).default("nojv-sandbox"),
  K8S_CPU_REQUEST: z.string().trim().default("500m"),
  K8S_CPU_LIMIT: z.string().trim().default("1"),
  K8S_MEMORY_REQUEST: z.string().trim().default("256Mi"),
  K8S_MEMORY_LIMIT: z.string().trim().default("512Mi"),
  // Worker settings
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: Record<string, string | undefined>): WorkerEnv {
  return workerEnvSchema.parse(input);
}
