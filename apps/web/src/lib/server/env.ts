import { randomBytes } from "node:crypto";

import { env } from "$env/dynamic/private";
import { z } from "zod";

const devAuthSecret = (): string => randomBytes(32).toString("base64");

const DEFAULT_ADVANCED_IMAGE_REGISTRIES = [
  "ghcr.io",
  "docker.io",
  "quay.io",
  "registry.gitlab.com",
  "gcr.io",
  "public.ecr.aws",
  "mcr.microsoft.com",
  "registry.k8s.io",
].join(",");

const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.url().default("postgresql://postgres:postgres@localhost:5432/nojv"),
    REDIS_URL: z.url().default("redis://localhost:6379"),

    ADVANCED_IMAGE_ALLOWED_REGISTRIES: z
      .string()
      .trim()
      .transform((val) => (val === "" ? DEFAULT_ADVANCED_IMAGE_REGISTRIES : val))
      .default(DEFAULT_ADVANCED_IMAGE_REGISTRIES),

    REGISTRY_PUBLIC_HOST: z.string().trim().default(""),
    REGISTRY_INTERNAL_URL: z.string().trim().default(""),
    REGISTRY_TOKEN_ISSUER: z.string().trim().default("nojv"),
    REGISTRY_TOKEN_PRIVATE_KEY: z.string().trim().default(""),
    REGISTRY_TOKEN_CERT: z.string().trim().default(""),
    REGISTRY_PULL_PASSWORD_HASH: z.string().trim().default(""),

    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.url().default("http://localhost:5173"),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
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
  );

export type WebEnv = z.output<typeof webEnvSchema>;

let _webEnv: WebEnv | undefined;

export function getWebEnv(): WebEnv {
  if (_webEnv) return _webEnv;
  if (env.NODE_ENV === "production") {
    for (const key of ["DATABASE_URL", "REDIS_URL"] as const) {
      if (!env[key]) {
        throw new Error(`${key} is required in production (refusing the localhost default).`);
      }
    }
  }
  _webEnv = webEnvSchema.parse(env);
  return _webEnv;
}
