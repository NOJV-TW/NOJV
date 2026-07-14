import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  StorageIntegrityError,
  getVerifiedObject,
  putImmutableObject,
} from "../../../packages/storage/src/object";

function pointer(key: string, body: Buffer) {
  return {
    key,
    sha256: createHash("sha256").update(body).digest("hex"),
    size: body.byteLength,
  };
}

function fakeClient(initial = new Map<string, Buffer>()) {
  const objects = new Map(initial);
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const input = command.input as Record<string, unknown>;
    if (command.constructor.name === "PutObjectCommand") {
      const key = input.Key as string;
      if (input.IfNoneMatch !== "*") throw new Error("missing immutable precondition");
      if (objects.has(key)) {
        const error = new Error("PreconditionFailed");
        error.name = "PreconditionFailed";
        throw error;
      }
      objects.set(key, Buffer.from(input.Body as Buffer));
      return {};
    }
    if (command.constructor.name === "GetObjectCommand") {
      const body = objects.get(input.Key as string);
      if (!body) {
        const error = new Error("NoSuchKey");
        error.name = "NoSuchKey";
        throw error;
      }
      return {
        Body: (async function* () {
          yield body;
        })(),
      };
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  });
  return { client: { send } as never, objects, send };
}

describe("immutable storage objects", () => {
  it("writes with an atomic create-only precondition and returns verified metadata", async () => {
    const fake = fakeClient();
    const body = Buffer.from("immutable");

    const stored = await putImmutableObject(fake.client, "objects/version-1", body, {
      contentType: "text/plain",
    });

    expect(stored).toEqual(pointer("objects/version-1", body));
    expect(fake.send.mock.calls[0]?.[0].input).toMatchObject({
      IfNoneMatch: "*",
      ChecksumAlgorithm: "SHA256",
      ContentLength: body.byteLength,
    });
  });

  it("treats an existing byte-identical immutable object as an idempotent success", async () => {
    const body = Buffer.from("same");
    const fake = fakeClient(new Map([["objects/version-1", body]]));

    await expect(putImmutableObject(fake.client, "objects/version-1", body)).resolves.toEqual(
      pointer("objects/version-1", body),
    );
  });

  it("never overwrites an existing key with different bytes", async () => {
    const oldBody = Buffer.from("old");
    const fake = fakeClient(new Map([["objects/version-1", oldBody]]));

    await expect(
      putImmutableObject(fake.client, "objects/version-1", Buffer.from("new")),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
    expect(fake.objects.get("objects/version-1")).toEqual(oldBody);
  });

  it("fails closed when restored bytes do not match the persisted pointer", async () => {
    const body = Buffer.from("corrupt");
    const fake = fakeClient(new Map([["objects/version-1", body]]));

    await expect(
      getVerifiedObject(fake.client, { ...pointer("objects/version-1", body), size: 999 }),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
    await expect(
      getVerifiedObject(fake.client, {
        ...pointer("objects/version-1", body),
        sha256: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(StorageIntegrityError);
  });
});
