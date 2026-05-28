import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET ?? "nojv";

const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

// S3 DeleteObjects API caps each request at 1000 keys.
const DELETE_BATCH_SIZE = 1000;

export async function putText(client: S3Client, key: string, content: string): Promise<void> {
  // Explicit Buffer + ContentLength silences the AWS SDK unknown-length warning.
  const body = Buffer.from(content, "utf-8");
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: TEXT_CONTENT_TYPE,
    }),
  );
}

export async function getText(client: S3Client, key: string): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
  const body = response.Body;
  if (!body) {
    throw new Error(`No body returned for object ${key}`);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function listByPrefix(client: S3Client, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (typeof object.Key === "string") {
        keys.push(object.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Sum the byte sizes of every object under `prefix`. Used by per-problem
 * storage budgets — paginates through `ListObjectsV2` and adds `Size` from
 * each entry (LIST returns size without a per-key HEAD round-trip).
 */
export async function sumSizesByPrefix(client: S3Client, prefix: string): Promise<number> {
  let total = 0;
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (typeof object.Size === "number") {
        total += object.Size;
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return total;
}

export async function deleteBlob(client: S3Client, key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

export async function deleteBlobsByPrefix(client: S3Client, prefix: string): Promise<void> {
  let continuationToken: string | undefined;

  do {
    const listResponse = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const contents = listResponse.Contents ?? [];
    const keys = contents
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === "string");

    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
    }

    continuationToken = listResponse.IsTruncated
      ? listResponse.NextContinuationToken
      : undefined;
  } while (continuationToken);
}
