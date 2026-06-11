import { S3Client } from "@aws-sdk/client-s3";

import { getStorageEnv } from "./env";

export function createStorageClient(): S3Client {
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION } = getStorageEnv();

  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    throw new Error(
      "Missing S3 environment variables (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)",
    );
  }

  return new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    forcePathStyle: true,
  });
}

export function getStorageBaseUrl(): string {
  const { S3_PUBLIC_URL, S3_ENDPOINT } = getStorageEnv();
  return S3_PUBLIC_URL ?? S3_ENDPOINT ?? "";
}
