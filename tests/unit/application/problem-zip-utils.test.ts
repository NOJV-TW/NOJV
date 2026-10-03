import { createRequire } from "node:module";
import { type Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";

import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import { readZipEntryBounded } from "../../../packages/application/src/problem/zip-utils";

type ZipFile = Parameters<typeof readZipEntryBounded>[0];
const require = createRequire(
  new URL("../../../packages/application/package.json", import.meta.url),
);
const { Open } = require("unzipper") as {
  Open: { buffer(buffer: Buffer): Promise<{ files: ZipFile[] }> };
};

async function zipEntry(
  content: Buffer,
  compression: "STORE" | "DEFLATE",
  declaredSize?: number,
) {
  const zip = new JSZip();
  zip.file("input.txt", content);
  const archive = await zip.generateAsync({ type: "nodebuffer", compression });
  if (declaredSize !== undefined) {
    const centralDirectoryOffset = archive.readUInt32LE(archive.length - 6);
    archive.writeUInt32LE(declaredSize, 22);
    archive.writeUInt32LE(declaredSize, centralDirectoryOffset + 24);
  }
  const { files } = await Open.buffer(archive);
  return files[0];
}

const overflow = (path: string) => new Error(`Too large: ${path}`);

describe("bounded ZIP entry reads", () => {
  it.each(["STORE", "DEFLATE"] as const)(
    "reads a %s entry at the exact byte limit",
    async (compression) => {
      const content = Buffer.from("1 2\n3 4\n");
      const entry = await zipEntry(content, compression);
      await expect(readZipEntryBounded(entry, content.length, overflow)).resolves.toEqual(
        content,
      );
    },
  );

  it("rejects an exhausted budget before opening the entry", async () => {
    const entry = await zipEntry(Buffer.from("x"), "DEFLATE");
    const stream = vi.spyOn(entry, "stream");
    await expect(readZipEntryBounded(entry, 0, overflow)).rejects.toThrow(
      "Too large: input.txt",
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("stops real inflation when an entry with forged size metadata exceeds the limit", async () => {
    const entry = await zipEntry(Buffer.alloc(8 * 1024 * 1024, "x"), "DEFLATE", 1);
    expect(entry.uncompressedSize).toBe(1);
    const originalStream = entry.stream.bind(entry);
    const output = originalStream();
    let inflater: Readable | undefined;
    let inflatedBytes = 0;
    output.once("pipe", (source: Readable) => {
      inflater = source;
      source.on("data", (chunk: Buffer) => {
        inflatedBytes += chunk.length;
      });
    });
    entry.stream = () => output;
    const limit = 32 * 1024;

    try {
      await expect(readZipEntryBounded(entry, limit, overflow)).rejects.toThrow(
        "Too large: input.txt",
      );
      await setImmediate();
      expect(output.destroyed).toBe(true);
      expect(inflater?.destroyed).toBe(true);
      expect(inflatedBytes).toBeGreaterThan(limit);
      expect(inflatedBytes).toBeLessThanOrEqual(limit + 128 * 1024);
    } finally {
      output.destroy();
      inflater?.destroy();
    }
  });
});
