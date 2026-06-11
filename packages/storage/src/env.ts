import { z } from "zod";

export const STORAGE_REQUIRED_IN_PRODUCTION = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
] as const;

export const storageEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().default("nojv"),
    S3_REGION: z.string().default("auto"),
    S3_PUBLIC_URL: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== "production") return;
    for (const key of STORAGE_REQUIRED_IN_PRODUCTION) {
      if (!val[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }
  });

export type StorageEnv = z.output<typeof storageEnvSchema>;

let cached: StorageEnv | undefined;

export function getStorageEnv(): StorageEnv {
  cached ??= storageEnvSchema.parse(process.env);
  return cached;
}
