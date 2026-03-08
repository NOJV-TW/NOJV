import { z } from "zod";

export const sandboxEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  SANDBOX_SHARED_TOKEN: z.string().trim().min(8)
});

export type SandboxEnv = z.infer<typeof sandboxEnvSchema>;

export function parseSandboxEnv(input: Record<string, string | undefined>): SandboxEnv {
  return sandboxEnvSchema.parse(input);
}
