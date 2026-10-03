import { describe, expect, it, vi } from "vitest";

import {
  assertJsonBodyWithinLimit,
  JSON_BODY_LIMIT_BYTES,
  readJsonBody,
  readFormData,
} from "$lib/server/shared/api-handler";

function eventWithContentLength(value: string | null) {
  return {
    request: { headers: { get: (k: string) => (k === "content-length" ? value : null) } },
  } as never;
}

describe("assertJsonBodyWithinLimit", () => {
  it("passes when content-length is under the limit", () => {
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength("500"))).not.toThrow();
  });

  it("passes when content-length header is absent", () => {
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength(null))).not.toThrow();
  });

  it("throws when content-length exceeds the default 1MB limit", () => {
    expect(() =>
      assertJsonBodyWithinLimit(eventWithContentLength(String(JSON_BODY_LIMIT_BYTES + 1))),
    ).toThrow();
  });

  it("honors a caller-supplied limit", () => {
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength("2000"), 1000)).toThrow();
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength("800"), 1000)).not.toThrow();
  });
});

describe("readFormData", () => {
  it("rejects streamed overflow and cancels before multipart parsing", async () => {
    const cancel = vi.fn();
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(11));
        },
        cancel,
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readFormData({ request } as never, 10)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects malformed multipart as 400 after the size check", async () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: "bad multipart",
    });
    await expect(readFormData({ request } as never, 1024)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("reads an allowed multipart upload", async () => {
    const form = new FormData();
    form.set("image", new File(["image"], "image.png", { type: "image/png" }));
    const request = new Request("http://localhost/upload", { method: "POST", body: form });
    const parsed = await readFormData({ request } as never, 1024);
    expect(await (parsed.get("image") as File).text()).toBe("image");
  });
});

describe("readJsonBody", () => {
  function event(body: string) {
    return { request: new Request("http://localhost/test", { method: "POST", body }) } as never;
  }

  it("validates actual bytes without a Content-Length header", async () => {
    await expect(readJsonBody(event('"éé"'), 5)).rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(event('"éé"'), 6)).resolves.toBe("éé");
  });

  it("rejects malformed JSON with a clear 400", async () => {
    await expect(readJsonBody(event("{"))).rejects.toMatchObject({
      status: 400,
      body: { message: "Invalid request body: expected valid JSON." },
    });
  });
});
