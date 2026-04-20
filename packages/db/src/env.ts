import { z } from "zod";

const dbEnvSchema = z.object({
  DATABASE_URL: z.url().default("postgresql://postgres:postgres@localhost:5432/nojv"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

type DatabaseEnv = z.infer<typeof dbEnvSchema>;

export function parseDatabaseEnv(input: Record<string, string | undefined>): DatabaseEnv {
  return dbEnvSchema.parse(input);
}
