import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535),
  REDIS_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  SANDBOX_IMAGE: z.string().trim().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64),
  WORKER_MODE: z.enum(["all", "judge", "platform"]).default("all"),
  SANDBOX_MEMORY_HEADROOM_MB: z.coerce.number().int().min(0).max(1024).default(64),
  SANDBOX_MAX_MEMORY_MB: z.coerce.number().int().min(128).max(8192).default(2048),
  REGISTRY_GC_IMAGE: z.string().trim().min(1).default("registry:2.8.3"),
  REGISTRY_GC_NAMESPACE: z.string().trim().min(1).default("nojv"),
  REGISTRY_GC_CONFIG_CONFIGMAP: z.string().trim().min(1).default("nojv-registry-config"),
  REGISTRY_GC_S3_SECRET: z.string().trim().min(1).default("nojv-runtime-secrets"),
});

const dockerEnvSchema = baseEnvSchema.extend({
  EXECUTION_BACKEND: z.literal("docker"),
  SANDBOX_CPU_LIMIT: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/),
  SANDBOX_MEMORY_MB: z.coerce.number().int().min(128).max(4096),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().min(16).max(512),
  K8S_NAMESPACE: z.string().trim().min(1).optional(),
  K8S_CPU_REQUEST: z.string().trim().optional(),
  K8S_CPU_LIMIT: z.string().trim().optional(),
  K8S_MEMORY_REQUEST: z.string().trim().optional(),
  K8S_MEMORY_LIMIT: z.string().trim().optional(),
  EGRESS_PROXY_IMAGE: z.string().trim().optional(),
  K8S_IMAGE_PULL_SECRET: z.string().trim().min(1).optional(),
});

const kubernetesEnvSchema = baseEnvSchema.extend({
  EXECUTION_BACKEND: z.literal("kubernetes"),
  K8S_NAMESPACE: z.string().trim().min(1),
  K8S_CPU_REQUEST: z.string().trim().min(1),
  K8S_CPU_LIMIT: z.string().trim().min(1),
  K8S_MEMORY_REQUEST: z.string().trim().min(1),
  K8S_MEMORY_LIMIT: z.string().trim().min(1),
  EGRESS_PROXY_IMAGE: z.string().trim().min(1),
  K8S_IMAGE_PULL_SECRET: z.string().trim().min(1).optional(),
  NOJV_ALLOW_UNENFORCED_NETWORK_POLICY: z.stringbool().optional().default(false),
});

export const workerEnvSchema = z.discriminatedUnion("EXECUTION_BACKEND", [
  dockerEnvSchema,
  kubernetesEnvSchema,
]);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(input: Record<string, string | undefined>): WorkerEnv {
  return workerEnvSchema.parse(input);
}
