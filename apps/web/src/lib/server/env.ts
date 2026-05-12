import { env } from "$env/dynamic/private";
import { z } from "zod";

const DEV_AUTH_SECRET = "dev-secret-do-not-use-in-production";

const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.url().default("postgresql://postgres:postgres@localhost:5432/nojv"),
    REDIS_URL: z.url().default("redis://localhost:6379"),

    // BETTER_AUTH_SECRET falls back to a dev default in non-prod; required in prod (enforced below).
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.url().default("http://localhost:5173"),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM_DOMAIN: z.string().optional(),
  })
  .transform((val) => ({
    ...val,
    BETTER_AUTH_SECRET:
      val.BETTER_AUTH_SECRET ?? (val.NODE_ENV === "production" ? undefined : DEV_AUTH_SECRET),
  }))
  .refine(
    (val) => typeof val.BETTER_AUTH_SECRET === "string" && val.BETTER_AUTH_SECRET.length > 0,
    {
      message: "BETTER_AUTH_SECRET is required in production",
      path: ["BETTER_AUTH_SECRET"],
    },
  );

export type WebEnv = z.output<typeof webEnvSchema>;

let _webEnv: WebEnv | undefined;

/**
 * Lazily parsed and cached environment. Throws on first access if validation
 * fails, ensuring the app never starts with a misconfigured environment.
 */
export function getWebEnv(): WebEnv {
  _webEnv ??= webEnvSchema.parse(env);
  return _webEnv;
}
