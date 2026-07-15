import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { materializePayload } from "../../../apps/sandbox-runner/src/payload-materializer";

const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nojv-payload-"));
  roots.push(root);
  const payloadDir = path.join(root, "payload");
  const submissionDir = path.join(root, "submission");
  await fs.mkdir(payloadDir);
  await fs.mkdir(submissionDir);
  return { payloadDir, submissionDir };
}

async function writeManifest(
  payloadDir: string,
  file: { path: string; chunks: string[]; size: number; sha256: string },
) {
  await fs.writeFile(
    path.join(payloadDir, "payload-manifest.json"),
    JSON.stringify({ version: 1, files: [file] }),
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("materializePayload", () => {
  it("reconstructs ordered chunks and verifies the file", async () => {
    const { payloadDir, submissionDir } = await fixture();
    const body = Buffer.from("hello 世界\n", "utf8");
    await fs.writeFile(path.join(payloadDir, "chunk-000000"), body.subarray(0, 7));
    await fs.writeFile(path.join(payloadDir, "chunk-000001"), body.subarray(7));
    await writeManifest(payloadDir, {
      path: "testcase-0-input.txt",
      chunks: ["chunk-000000", "chunk-000001"],
      size: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    });

    await materializePayload({ payloadDir, submissionDir });

    expect(await fs.readFile(path.join(submissionDir, "testcase-0-input.txt"))).toEqual(body);
    expect(await fs.readdir(submissionDir)).toEqual(["testcase-0-input.txt"]);
  });

  it.each(["../escape", "nested/input.txt", "", "bad\0name"])(
    "rejects unsafe destination path %j",
    async (unsafePath) => {
      const { payloadDir, submissionDir } = await fixture();
      const body = Buffer.from("x");
      await fs.writeFile(path.join(payloadDir, "chunk-000000"), body);
      await writeManifest(payloadDir, {
        path: unsafePath,
        chunks: ["chunk-000000"],
        size: 1,
        sha256: createHash("sha256").update(body).digest("hex"),
      });

      await expect(materializePayload({ payloadDir, submissionDir })).rejects.toThrow();
      expect(await fs.readdir(submissionDir)).toEqual([]);
    },
  );

  it("rejects a missing chunk without publishing partial files", async () => {
    const { payloadDir, submissionDir } = await fixture();
    await writeManifest(payloadDir, {
      path: "input.txt",
      chunks: ["chunk-000000"],
      size: 1,
      sha256: createHash("sha256").update("x").digest("hex"),
    });

    await expect(materializePayload({ payloadDir, submissionDir })).rejects.toThrow();
    expect(await fs.readdir(submissionDir)).toEqual([]);
  });

  it.each([
    { size: 2, sha256: createHash("sha256").update("x").digest("hex") },
    { size: 1, sha256: "0".repeat(64) },
  ])("rejects integrity mismatch %#", async ({ size, sha256 }) => {
    const { payloadDir, submissionDir } = await fixture();
    await fs.writeFile(path.join(payloadDir, "chunk-000000"), "x");
    await writeManifest(payloadDir, {
      path: "input.txt",
      chunks: ["chunk-000000"],
      size,
      sha256,
    });

    await expect(materializePayload({ payloadDir, submissionDir })).rejects.toThrow(
      /integrity/i,
    );
    expect(await fs.readdir(submissionDir)).toEqual([]);
  });
});
