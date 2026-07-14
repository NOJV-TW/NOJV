import { describe, expect, it } from "vitest";

import { readImageUploadUrl } from "$lib/utils/image-upload-response";

describe("readImageUploadUrl", () => {
  it("returns the non-empty URL from a successful response", async () => {
    const response = new Response(JSON.stringify({ url: "/images/example.png" }), {
      status: 200,
    });

    await expect(readImageUploadUrl(response, "Upload failed")).resolves.toBe(
      "/images/example.png",
    );
  });

  it("surfaces a server error message", async () => {
    const response = new Response(JSON.stringify({ message: "Image is too large" }), {
      status: 413,
    });

    await expect(readImageUploadUrl(response, "Upload failed")).rejects.toThrow(
      "Image is too large",
    );
  });

  it.each([
    new Response("not-json", { status: 500 }),
    new Response(JSON.stringify({}), { status: 200 }),
    new Response(JSON.stringify({ url: "" }), { status: 200 }),
  ])("fails honestly when response %s has no usable URL", async (response) => {
    await expect(readImageUploadUrl(response, "Upload failed")).rejects.toThrow(
      "Upload failed",
    );
  });
});
