import { z } from "zod";

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("nojv"),
  S3_REGION: z.string().default("auto"),
  S3_PUBLIC_URL: z.string().optional(),
});

export type StorageEnv = z.output<typeof storageEnvSchema>;

let cached: StorageEnv | undefined;

export function getStorageEnv(): StorageEnv {
  cached ??= storageEnvSchema.parse(process.env);
  return cached;
}
