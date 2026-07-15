import { createHash } from "node:crypto";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import { getStorageEnv } from "./env";

let cachedBucket: string | undefined;
function bucket(): string {
  return (cachedBucket ??= getStorageEnv().S3_BUCKET);
}

export interface StorageObjectPointer {
  [key: string]: number | string;
  key: string;
  sha256: string;
  size: number;
}

export class StorageIntegrityError extends Error {
  constructor(key: string, detail: string) {
    super(`Storage object integrity failure for ${key}: ${detail}`);
    this.name = "StorageIntegrityError";
  }
}

export function isStorageObjectNotFoundError(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const candidate = reason as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export function isStorageObjectPointer(value: unknown): value is StorageObjectPointer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StorageObjectPointer>;
  return (
    typeof candidate.key === "string" &&
    candidate.key.length > 0 &&
    typeof candidate.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(candidate.sha256) &&
    typeof candidate.size === "number" &&
    Number.isSafeInteger(candidate.size) &&
    candidate.size >= 0
  );
}

export function assertStorageObjectPointer(value: unknown): StorageObjectPointer {
  if (!isStorageObjectPointer(value)) {
    throw new StorageIntegrityError("<pointer>", "persisted pointer is malformed");
  }
  return value;
}

export function storagePointerFor(key: string, body: Buffer): StorageObjectPointer {
  return {
    key,
    sha256: createHash("sha256").update(body).digest("hex"),
    size: body.byteLength,
  };
}

export async function putImmutableObject(
  client: S3Client,
  key: string,
  body: Buffer,
  options: { contentType?: string } = {},
): Promise<StorageObjectPointer> {
  const pointer = storagePointerFor(key, body);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ...(options.contentType ? { ContentType: options.contentType } : {}),
        ChecksumAlgorithm: "SHA256",
        ChecksumSHA256: Buffer.from(pointer.sha256, "hex").toString("base64"),
        IfNoneMatch: "*",
      }),
    );
  } catch (reason) {
    if (!isPreconditionFailure(reason)) throw reason;
    await getVerifiedObject(client, pointer);
  }
  return pointer;
}

function isPreconditionFailure(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const candidate = reason as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

export async function getVerifiedObject(
  client: S3Client,
  rawPointer: StorageObjectPointer,
): Promise<Buffer> {
  const pointer = assertStorageObjectPointer(rawPointer);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: pointer.key,
    }),
  );
  if (!response.Body) {
    throw new StorageIntegrityError(pointer.key, "object body is missing");
  }

  if (response.ContentLength !== undefined && response.ContentLength !== pointer.size) {
    throw new StorageIntegrityError(
      pointer.key,
      `expected ${String(pointer.size)} bytes, received ${String(response.ContentLength)}`,
    );
  }

  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    received += chunk.byteLength;
    if (received > pointer.size) {
      throw new StorageIntegrityError(
        pointer.key,
        `expected ${String(pointer.size)} bytes, received at least ${String(received)}`,
      );
    }
    chunks.push(chunk);
    hash.update(chunk);
  }
  if (received !== pointer.size) {
    throw new StorageIntegrityError(
      pointer.key,
      `expected ${String(pointer.size)} bytes, received ${String(received)}`,
    );
  }
  const actualSha256 = hash.digest("hex");
  if (actualSha256 !== pointer.sha256) {
    throw new StorageIntegrityError(pointer.key, "SHA-256 mismatch");
  }
  return Buffer.concat(chunks, received);
}

export function putImmutableText(
  client: S3Client,
  key: string,
  content: string,
): Promise<StorageObjectPointer> {
  return putImmutableObject(client, key, Buffer.from(content, "utf8"), {
    contentType: "text/plain; charset=utf-8",
  });
}

export async function getVerifiedText(
  client: S3Client,
  pointer: StorageObjectPointer,
): Promise<string> {
  return (await getVerifiedObject(client, pointer)).toString("utf8");
}
