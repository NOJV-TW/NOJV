import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

const PAYLOAD_MANIFEST_FILE = "payload-manifest.json";
const PAYLOAD_PATH_PATTERN = /^[-._A-Za-z0-9]+$/;
const CHUNK_NAME_PATTERN = /^chunk-\d+$/;

const manifestSchema = z.object({
  version: z.literal(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        chunks: z.array(z.string().regex(CHUNK_NAME_PATTERN)).max(100_000),
        size: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(10_000),
});

function assertSafePayloadPath(value: string): void {
  if (value === "." || value === ".." || !PAYLOAD_PATH_PATTERN.test(value)) {
    throw new Error(`Invalid sandbox payload destination: ${JSON.stringify(value)}`);
  }
}

async function writeAll(handle: fs.FileHandle, body: Buffer): Promise<void> {
  let offset = 0;
  while (offset < body.byteLength) {
    const { bytesWritten } = await handle.write(body, offset, body.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error("Sandbox payload write made no progress.");
    offset += bytesWritten;
  }
}

async function materializeFile(
  payloadDir: string,
  stagingDir: string,
  file: z.infer<typeof manifestSchema>["files"][number],
): Promise<void> {
  assertSafePayloadPath(file.path);
  const destination = path.join(stagingDir, file.path);
  const handle = await fs.open(destination, "wx", 0o600);
  const hash = createHash("sha256");
  let received = 0;

  try {
    for (const chunkName of file.chunks) {
      const chunk = await fs.readFile(path.join(payloadDir, chunkName));
      received += chunk.byteLength;
      if (received > file.size) {
        throw new Error(`Sandbox payload integrity failure for ${file.path}: size overflow.`);
      }
      hash.update(chunk);
      await writeAll(handle, chunk);
    }
  } finally {
    await handle.close();
  }

  if (received !== file.size) {
    throw new Error(
      `Sandbox payload integrity failure for ${file.path}: expected ${String(file.size)} bytes, received ${String(received)}.`,
    );
  }
  if (hash.digest("hex") !== file.sha256) {
    throw new Error(`Sandbox payload integrity failure for ${file.path}: SHA-256 mismatch.`);
  }
}

export async function materializePayload(input: {
  payloadDir: string;
  submissionDir: string;
}): Promise<void> {
  const existing = await fs.readdir(input.submissionDir);
  if (existing.length > 0) {
    throw new Error("Sandbox submission volume must be empty before payload materialization.");
  }

  const manifestRaw = await fs.readFile(
    path.join(input.payloadDir, PAYLOAD_MANIFEST_FILE),
    "utf8",
  );
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const destinations = new Set<string>();
  for (const file of manifest.files) {
    assertSafePayloadPath(file.path);
    if (destinations.has(file.path)) {
      throw new Error(`Duplicate sandbox payload destination: ${file.path}`);
    }
    destinations.add(file.path);
  }

  const stagingDir = path.join(input.submissionDir, ".payload-staging");
  await fs.mkdir(stagingDir, { mode: 0o700 });
  try {
    for (const file of manifest.files) {
      await materializeFile(input.payloadDir, stagingDir, file);
    }
    for (const file of manifest.files) {
      await fs.rename(
        path.join(stagingDir, file.path),
        path.join(input.submissionDir, file.path),
      );
    }
    await fs.rmdir(stagingDir);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
