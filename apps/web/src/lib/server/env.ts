import { randomBytes } from "node:crypto";

import { env } from "$env/dynamic/private";
import { z } from "zod";

const devAuthSecret = (): string => randomBytes(32).toString("base64");

const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.url().default("postgresql://postgres:postgres@localhost:5432/nojv"),
    REDIS_URL: z.url().default("redis://localhost:6379"),

    EXECUTION_BACKEND: z.enum(["docker", "kubernetes"]).default("docker"),

    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.url().default("http://localhost:5173"),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    EMAIL_PROVIDER: z.enum(["resend"]).default("resend"),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM_DOMAIN: z.string().optional(),

    EDGE_TRUST_SECRET: z.string().optional(),

    DEV_DISABLE_ADMIN_2FA: z.stringbool().default(false),
  })
  .transform((val) => ({
    ...val,
    BETTER_AUTH_SECRET:
      val.BETTER_AUTH_SECRET ?? (val.NODE_ENV === "production" ? undefined : devAuthSecret()),
  }))
  .refine(
    (val) => typeof val.BETTER_AUTH_SECRET === "string" && val.BETTER_AUTH_SECRET.length >= 32,
    {
      message:
        "BETTER_AUTH_SECRET is required in production and must be at least 32 characters",
      path: ["BETTER_AUTH_SECRET"],
    },
  )
  .refine(
    (val) =>
      val.NODE_ENV !== "production" ||
      (typeof val.EDGE_TRUST_SECRET === "string" && val.EDGE_TRUST_SECRET.length >= 32),
    {
      message: "EDGE_TRUST_SECRET is required in production and must be at least 32 characters",
      path: ["EDGE_TRUST_SECRET"],
    },
  )
  .refine((val) => !(val.DEV_DISABLE_ADMIN_2FA && val.NODE_ENV === "production"), {
    message: "DEV_DISABLE_ADMIN_2FA must never be set in production",
    path: ["DEV_DISABLE_ADMIN_2FA"],
  });

export type WebEnv = z.output<typeof webEnvSchema>;

let _webEnv: WebEnv | undefined;

export function getWebEnv(): WebEnv {
  if (_webEnv) return _webEnv;
  if (env.NODE_ENV === "production") {
    for (const key of ["DATABASE_URL", "REDIS_URL", "EDGE_TRUST_SECRET"] as const) {
      if (!env[key]) {
        throw new Error(`${key} is required in production (refusing the localhost default).`);
      }
    }
  }
  _webEnv = webEnvSchema.parse(env);
  return _webEnv;
}
