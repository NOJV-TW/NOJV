import { describe, expect, it, vi } from "vitest";

import {
  downloadProblemImage,
  listImageObjectInventory,
  putImmutableObject,
  storagePointerFor,
} from "../../../packages/storage/src";

function createFakeS3() {
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; contentLength?: number }
  >();
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const input = command.input as {
      Key: string;
      Prefix?: string;
      Body?: Buffer;
      ContentType?: string;
      IfNoneMatch?: string;
    };
    if (command.constructor.name === "PutObjectCommand") {
      if (input.IfNoneMatch === "*" && objects.has(input.Key)) {
        throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed" });
      }
      objects.set(input.Key, {
        body: input.Body ?? Buffer.alloc(0),
        contentType: input.ContentType ?? "application/octet-stream",
      });
      return {};
    }
    if (command.constructor.name === "ListObjectsV2Command") {
      return {
        Contents: [...objects.keys()]
          .filter((key) => key.startsWith(input.Prefix!))
          .map((Key) => ({ Key })),
      };
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = objects.get(input.Key);
      if (!object) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return {
        Body: (async function* () {
          yield object.body;
        })(),
        ContentType: object.contentType,
        ContentLength: object.contentLength,
      };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  return { client: { send } as never, objects, send };
}

describe("image object storage", () => {
  it("reads owned images by problem id and a single filename", async () => {
    const fake = createFakeS3();
    await putImmutableObject(
      fake.client,
      "problems/prob_1/images/a.webp",
      Buffer.from("image"),
      { contentType: "image/webp" },
    );
    await expect(downloadProblemImage(fake.client, "prob_1", "a.webp")).resolves.toEqual({
      body: Buffer.from("image"),
      contentType: "image/webp",
    });
    await expect(downloadProblemImage(fake.client, "prob_1", "../a.webp")).rejects.toThrow();
  });

  it("inventories exact checksums, sizes and content types with bounded network requests", async () => {
    const fake = createFakeS3();
    const key = "problems/prob_1/images/a.png";
    const body = Buffer.from("image");
    await putImmutableObject(fake.client, key, body, { contentType: "image/png" });
    await expect(
      listImageObjectInventory(fake.client, "problems/prob_1/images/"),
    ).resolves.toEqual([{ pointer: storagePointerFor(key, body), contentType: "image/png" }]);
    for (const call of fake.send.mock.calls.slice(1))
      expect(call[1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
  });

  it.each([true, false])(
    "rejects oversized legacy image metadata or streams (ContentLength=%s)",
    async (header) => {
      const fake = createFakeS3();
      const key = "problems/prob_1/images/oversized.png";
      fake.objects.set(key, {
        body: Buffer.alloc(5 * 1024 * 1024 + 1),
        contentType: "image/png",
        ...(header ? { contentLength: 5 * 1024 * 1024 + 1 } : {}),
      });
      await expect(
        listImageObjectInventory(fake.client, "problems/prob_1/images/"),
      ).rejects.toThrow("5 MiB");
    },
  );

  it("passes one abort signal through an immutable collision and its verification", async () => {
    const fake = createFakeS3();
    const key = "problems/prob_1/images/a.png";
    const body = Buffer.from("image");
    const abortSignal = AbortSignal.timeout(60_000);
    await putImmutableObject(fake.client, key, body);
    await putImmutableObject(fake.client, key, body, { abortSignal });
    expect(fake.send.mock.calls.slice(1).map((call) => call[1])).toEqual([
      { abortSignal },
      { abortSignal },
    ]);
  });
});
