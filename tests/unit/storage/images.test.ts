import { describe, expect, it, vi } from "vitest";

import {
  downloadProblemImage,
  downloadUserAvatar,
  uploadProblemImage,
  uploadUserAvatar,
} from "../../../packages/storage/src";

function createFakeS3() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const input = command.input as { Key: string; Body?: Buffer; ContentType?: string };
    if (command.constructor.name === "PutObjectCommand") {
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

  it("uploadUserAvatar returns the stable avatar key", async () => {
    const fake = createFakeS3();

    const key = await uploadUserAvatar(fake.client, "usr_1", Buffer.from("avatar"));

    expect(key).toBe("avatars/usr_1.webp");
    expect(key).not.toMatch(/^https?:\/\//);
    expect(await downloadUserAvatar(fake.client, "usr_1")).toEqual(Buffer.from("avatar"));
  });
});
