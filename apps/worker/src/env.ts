import { z } from "zod";

export const workerEnvSchema = z
  .object({
    EXECUTION_BACKEND: z.enum(["docker_local", "remote_http"]).default("docker_local"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    SANDBOX_BASE_URL: z.url().optional(),
    SANDBOX_CPU_LIMIT: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/)
      .default("1"),
    SANDBOX_IMAGE: z.string().trim().min(1).default("nojv-sandbox:local"),
    SANDBOX_MEMORY_MB: z.coerce.number().int().min(128).max(4096).default(256),
    SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(512).default(64),
    SANDBOX_SHARED_TOKEN: z.string().trim().min(8).optional(),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4)
  })
  .superRefine((value, ctx) => {
    if (value.EXECUTION_BACKEND !== "remote_http") {
      return;
    }

    if (!value.SANDBOX_BASE_URL) {
      ctx.addIssue({
        code: "custom",
        message: "SANDBOX_BASE_URL is required for remote_http backend",
        path: ["SANDBOX_BASE_URL"]
      });
    }

    if (!value.SANDBOX_SHARED_TOKEN) {
      ctx.addIssue({
        code: "custom",
        message: "SANDBOX_SHARED_TOKEN is required for remote_http backend",
        path: ["SANDBOX_SHARED_TOKEN"]
      });
    }
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: Record<string, string | undefined>): WorkerEnv {
  return workerEnvSchema.parse(input);
}
