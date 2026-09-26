import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkerKey,
  createStorageClient,
  deleteBlobsByPrefix,
  getStorageEnv,
  getSubmissionSources,
  getVerdictDetail,
  getVerifiedObject,
  interactorKey,
  listByPrefix,
  putImmutableObject,
  putObjectIfAbsent,
  putSubmissionSources,
  putVerdictDetail,
  storagePointerFor,
  testcaseInputFileKey,
  testcaseInputKey,
  testcaseOutputKey,
  workspaceFileKey,
} from "@nojv/storage";

const enabled = process.env.S3_CONFORMANCE === "1";
const MiB = 1024 * 1024;

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

async function readBody(client: S3Client, bucket: string, key: string): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await response.Body!.transformToByteArray());
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

describe.skipIf(!enabled)("S3 backend conformance", () => {
  let client: S3Client;
  let bucket: string;
  const runId = `conformance-${randomUUID()}`;
  const root = `conformance/${runId}/`;

  beforeAll(() => {
    client = createStorageClient();
    bucket = getStorageEnv().S3_BUCKET;
  });

  afterAll(async () => {
    if (!client) return;
    for (const prefix of [root, `problems/${runId}/`, `submissions/${runId}/`]) {
      await deleteBlobsByPrefix(client, prefix);
    }
  });

  describe("R1 atomic create-if-absent", () => {
    it("rejects a second If-None-Match put with 412 and keeps the first object", async () => {
      const key = `${root}r1/sequential`;
      const first = Buffer.from("first writer");

      await expect(putObjectIfAbsent(client, key, first)).resolves.toMatchObject({
        created: true,
      });
      await expect(
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: Buffer.from("second writer"),
            IfNoneMatch: "*",
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
      await expect(
        putObjectIfAbsent(client, key, Buffer.from("third writer")),
      ).resolves.toMatchObject({ created: false });

      await expect(getVerifiedObject(client, storagePointerFor(key, first))).resolves.toEqual(
        first,
      );
    });

    it("lets exactly one of many concurrent puts win", async () => {
      for (let round = 0; round < 5; round++) {
        const key = `${root}r1/race-${String(round)}`;
        const bodies = Array.from({ length: 16 }, (_, i) =>
          Buffer.concat([Buffer.from(`writer-${String(i)}-`), randomBytes(64 * 1024)]),
        );

        const results = await Promise.all(
          bodies.map((body) => putObjectIfAbsent(client, key, body)),
        );
        const winners = results.filter((result) => result.created);

        expect(winners).toHaveLength(1);
        const stored = await readBody(client, bucket, key);
        expect(sha256(stored)).toBe(winners[0]!.pointer.sha256);
      }
    });

    it("treats an identical retry of putImmutableObject as success", async () => {
      const key = `${root}r1/retry`;
      const body = randomBytes(4096);

      const first = await putImmutableObject(client, key, body);
      await expect(putImmutableObject(client, key, body)).resolves.toEqual(first);
    });
  });

  describe("R2 checksums", () => {
    it("rejects a PutObject whose ChecksumSHA256 does not match the body", async () => {
      const key = `${root}r2/wrong-checksum`;
      const body = Buffer.from("actual body");
      const wrong = createHash("sha256").update("other body").digest("base64");

      await expect(
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ChecksumAlgorithm: "SHA256",
            ChecksumSHA256: wrong,
          }),
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 400 } });
      await expect(
        client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    });

    it("accepts the SDK default flexible checksums on PutObject and DeleteObjects", async () => {
      const keys = [`${root}r2/default-a`, `${root}r2/default-b`];
      for (const key of keys) {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(key) }),
        );
      }

      const deleted = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );

      expect(deleted.Errors ?? []).toEqual([]);
      expect(await listByPrefix(client, `${root}r2/default-`)).toEqual([]);
    });

    it("round-trips ContentType", async () => {
      const key = `${root}r2/content-type`;
      await putImmutableObject(client, key, Buffer.from("RIFF"), { contentType: "image/webp" });

      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

      expect(head.ContentType).toBe("image/webp");
    });
  });

  describe("listing and batch delete", () => {
    const prefix = `${root}list/`;
    const flatKeys = Array.from(
      { length: 1050 },
      (_, i) => `${prefix}a/${String(i).padStart(5, "0")}`,
    );
    const nestedKeys = Array.from(
      { length: 20 },
      (_, i) => `${prefix}b/c/${String(i).padStart(5, "0")}`,
    );

    beforeAll(async () => {
      await inBatches([...flatKeys, ...nestedKeys], 25, (key) =>
        client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(key) })),
      );
    });

    it("paginates ListObjectsV2 past 1000 keys", async () => {
      const firstPage = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
      );

      expect(firstPage.IsTruncated).toBe(true);
      expect(firstPage.KeyCount).toBe(1000);
      expect(firstPage.NextContinuationToken).toBeTruthy();
      expect((await listByPrefix(client, prefix)).sort()).toEqual(
        [...flatKeys, ...nestedKeys].sort(),
      );
    });

    it("groups CommonPrefixes with a delimiter", async () => {
      const response = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/" }),
      );

      expect(response.Contents ?? []).toEqual([]);
      expect((response.CommonPrefixes ?? []).map((entry) => entry.Prefix)).toEqual([
        `${prefix}a/`,
        `${prefix}b/`,
      ]);
    });

    it("paginates ListObjects v1 with a marker", async () => {
      const first = await client.send(
        new ListObjectsCommand({ Bucket: bucket, Prefix: `${prefix}a/` }),
      );
      const firstKeys = (first.Contents ?? []).map((entry) => entry.Key);
      const second = await client.send(
        new ListObjectsCommand({
          Bucket: bucket,
          Prefix: `${prefix}a/`,
          Marker: firstKeys.at(-1),
        }),
      );

      expect(first.IsTruncated).toBe(true);
      expect(firstKeys).toHaveLength(1000);
      expect([...firstKeys, ...(second.Contents ?? []).map((entry) => entry.Key)]).toEqual(
        flatKeys,
      );
    });

    it("removes every key through DeleteObjects", async () => {
      await deleteBlobsByPrefix(client, prefix);

      expect(await listByPrefix(client, prefix)).toEqual([]);
    });
  });

  describe("R3 registry driver operations", () => {
    it("copies an object with CopyObject", async () => {
      const source = `${root}r3/copy-source`;
      const target = `${root}r3/copy-target`;
      const body = randomBytes(8192);
      await putImmutableObject(client, source, body, { contentType: "application/json" });

      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: target,
          CopySource: `${bucket}/${source}`,
        }),
      );

      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: target }));
      expect(head.ContentType).toBe("application/json");
      expect(await readBody(client, bucket, target)).toEqual(body);
    });

    it("completes a multipart upload that mixes UploadPart and UploadPartCopy", async () => {
      const source = `${root}r3/mpu-source`;
      const target = `${root}r3/mpu-target`;
      const sourceBody = randomBytes(6 * MiB);
      const firstPart = randomBytes(5 * MiB);
      const lastPart = randomBytes(1024);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: source, Body: sourceBody }),
      );

      const { UploadId } = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: target }),
      );
      const one = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: target,
          UploadId,
          PartNumber: 1,
          Body: firstPart,
        }),
      );
      const two = await client.send(
        new UploadPartCopyCommand({
          Bucket: bucket,
          Key: target,
          UploadId,
          PartNumber: 2,
          CopySource: `${bucket}/${source}`,
          CopySourceRange: `bytes=0-${String(5 * MiB - 1)}`,
        }),
      );
      const three = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: target,
          UploadId,
          PartNumber: 3,
          Body: lastPart,
        }),
      );

      const uploads = await client.send(
        new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: target }),
      );
      expect((uploads.Uploads ?? []).map((upload) => upload.UploadId)).toContain(UploadId);
      const parts = await client.send(
        new ListPartsCommand({ Bucket: bucket, Key: target, UploadId }),
      );
      expect((parts.Parts ?? []).map((part) => part.PartNumber)).toEqual([1, 2, 3]);

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: target,
          UploadId,
          MultipartUpload: {
            Parts: [
              { PartNumber: 1, ETag: one.ETag },
              { PartNumber: 2, ETag: two.CopyPartResult?.ETag },
              { PartNumber: 3, ETag: three.ETag },
            ],
          },
        }),
      );

      const expected = Buffer.concat([firstPart, sourceBody.subarray(0, 5 * MiB), lastPart]);
      expect(sha256(await readBody(client, bucket, target))).toBe(sha256(expected));
    });

    it("aborts a multipart upload", async () => {
      const key = `${root}r3/mpu-aborted`;
      const { UploadId } = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
      );
      await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId,
          PartNumber: 1,
          Body: randomBytes(1024),
        }),
      );

      await client.send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId }),
      );

      const uploads = await client.send(
        new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }),
      );
      expect((uploads.Uploads ?? []).map((upload) => upload.UploadId)).not.toContain(UploadId);
    });
  });

  describe("NOJV key shapes", () => {
    it("stores and lists every key family the storage package writes", async () => {
      const problemId = runId;
      const version = randomUUID();
      const pointers = await Promise.all(
        [
          testcaseInputKey(problemId, "tc1", version),
          testcaseOutputKey(problemId, "tc1", version),
          testcaseInputFileKey(problemId, "tc1", version, "data.txt"),
          testcaseInputFileKey(problemId, "tc1", version, "config.json"),
          workspaceFileKey(problemId, "file1", version),
          checkerKey(problemId, version),
          interactorKey(problemId, version),
          `problems/${problemId}/images/${randomUUID()}.png`,
        ].map((key) => putImmutableObject(client, key, Buffer.from(key))),
      );

      expect((await listByPrefix(client, `problems/${problemId}/`)).sort()).toEqual(
        pointers.map((pointer) => pointer.key).sort(),
      );
      for (const pointer of pointers) await getVerifiedObject(client, pointer);
    });

    it("stores submission sources, manifest and verdict detail", async () => {
      const submissionId = runId;
      const sources = [
        { path: "main.c", content: "int main(void) { return 0; }" },
        { path: "src/lib.c", content: "int lib(void) { return 1; }" },
        { path: "src/include/lib.h", content: "int lib(void);" },
      ];

      const manifest = await putSubmissionSources(client, submissionId, "g1", sources);
      const verdict = await putVerdictDetail(client, submissionId, "run1", { cases: [] });

      expect(await getSubmissionSources(client, manifest)).toEqual(
        [...sources].sort((a, b) => a.path.localeCompare(b.path)),
      );
      expect(await getVerdictDetail(client, verdict)).toEqual({ cases: [] });
    });

    it.each(["file-first", "dir-first"])(
      "rejects or fully stores a key that collides with a directory prefix (%s)",
      async (order) => {
        const key = `${root}collision/${order}`;
        const writes = order === "file-first" ? [key, `${key}/child`] : [`${key}/child`, key];
        const accepted: string[] = [];

        for (const target of writes) {
          const result = await putObjectIfAbsent(client, target, Buffer.from(target)).catch(
            (reason: unknown) => reason,
          );
          if (result instanceof Error) continue;
          expect(result).toMatchObject({ created: true });
          accepted.push(target);
        }

        expect(accepted[0]).toBe(writes[0]);
        expect((await listByPrefix(client, key)).sort()).toEqual([...accepted].sort());
        for (const target of accepted) {
          await getVerifiedObject(client, storagePointerFor(target, Buffer.from(target)));
        }
      },
    );

    it("stores a 255-character key segment", async () => {
      const key = `${root}long/${"a".repeat(255)}`;

      await expect(putImmutableObject(client, key, Buffer.from("long"))).resolves.toMatchObject(
        { key },
      );
    });
  });
});
