import { describe, expect, it, vi } from "vitest";

import {
  cacheRemoteImage,
  downloadProblemImage,
  downloadRemoteImage,
  downloadUserAvatar,
  uploadProblemImage,
  uploadUserAvatar,
} from "../../../packages/storage/src";

function createFakeS3() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const input = command.input as { Key: string; Body?: Buffer; ContentType?: string };
    if (command.constructor.name === "PutObjectCommand") {
      if (input.IfNoneMatch === "*" && objects.has(input.Key)) {
        const err = new Error("PreconditionFailed");
        err.name = "PreconditionFailed";
        throw err;
      }
      objects.set(input.Key, {
        body: input.Body ?? Buffer.alloc(0),
        contentType: input.ContentType ?? "application/octet-stream",
      });
      return {};
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = objects.get(input.Key);
      if (!object) {
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return {
        Body: (async function* () {
          yield object.body;
        })(),
        ContentType: object.contentType,
      };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  return { client: { send } as never, objects, send };
}

describe("image object storage", () => {
  it("uploadProblemImage returns an object key instead of an external URL", async () => {
    const fake = createFakeS3();

    const key = await uploadProblemImage(
      fake.client,
      "prob_1",
      Buffer.from("image"),
      "image/png",
    );

    expect(key).toMatch(/^problems\/prob_1\/images\/.+\.png$/);
    expect(key).not.toMatch(/^https?:\/\//);
    expect(fake.objects.get(key)?.contentType).toBe("image/png");
  });

  it("downloadProblemImage reads by problem id and filename", async () => {
    const fake = createFakeS3();
    const key = await uploadProblemImage(
      fake.client,
      "prob_1",
      Buffer.from("image"),
      "image/webp",
    );
    const filename = key.split("/").at(-1);

    const image = await downloadProblemImage(fake.client, "prob_1", filename!);

    expect(image.body.toString("utf8")).toBe("image");
    expect(image.contentType).toBe("image/webp");
  });

  it("uploadUserAvatar returns an immutable version key", async () => {
    const fake = createFakeS3();

    const key = await uploadUserAvatar(fake.client, "usr_1", Buffer.from("avatar"));

    expect(key).toMatch(/^avatars\/usr_1\/[0-9a-f-]+\.webp$/);
    expect(key).not.toMatch(/^https?:\/\//);
    const filename = key.split("/").at(-1)!;
    expect(await downloadUserAvatar(fake.client, "usr_1", filename)).toEqual(
      Buffer.from("avatar"),
    );
  });

  it("caches a remote image under a deterministic URL hash", async () => {
    const fake = createFakeS3();
    const url = "https://images.example/cat.png?size=2";

    const stored = await cacheRemoteImage(fake.client, url, Buffer.from("first"), "image/png");
    const key = [...fake.objects.keys()].find((candidate) =>
      candidate.startsWith("remote-images/"),
    );

    expect(key).toMatch(/^remote-images\/[a-f0-9]{64}$/);
    expect(stored).toEqual({ body: Buffer.from("first"), contentType: "image/png" });
    await expect(downloadRemoteImage(fake.client, url)).resolves.toEqual(stored);
  });

  it("keeps the first cached response when the same URL is written concurrently", async () => {
    const fake = createFakeS3();
    const url = "https://images.example/changing.png";

    await cacheRemoteImage(fake.client, url, Buffer.from("first"), "image/png");
    const stored = await cacheRemoteImage(
      fake.client,
      url,
      Buffer.from("second"),
      "image/jpeg",
    );

    expect(stored).toEqual({ body: Buffer.from("first"), contentType: "image/png" });
  });
});
