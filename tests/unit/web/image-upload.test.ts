import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRemoteImage } = vi.hoisted(() => ({ fetchRemoteImage: vi.fn() }));
vi.mock("$lib/server/remote-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/server/remote-image")>()),
  fetchRemoteImage,
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({}));

import { readImageUpload } from "$lib/server/image-upload";
import { RemoteImageError } from "$lib/server/remote-image";
import { MAX_IMAGE_SIZE } from "$lib/server/shared/file-validation";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
function event(form: FormData): RequestEvent {
  return {
    url: new URL("https://nojv.example/api/uploads/image"),
    request: new Request("https://nojv.example/api/uploads/image", {
      method: "POST",
      body: form,
    }),
  } as RequestEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  fetchRemoteImage.mockResolvedValue({ body: PNG, contentType: "image/png" });
});

describe("image upload input", () => {
  it("bounds the form body before fetching a remote image", async () => {
    const form = new FormData();
    form.set("url", "https://images.example/cat.png");
    const oversized = event(form);
    oversized.request.headers.set("content-length", String(MAX_IMAGE_SIZE + 64 * 1024 + 1));
    await expect(readImageUpload(oversized)).rejects.toMatchObject({ status: 413 });
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });
  it("imports a URL through the SSRF-safe bounded fetcher", async () => {
    const form = new FormData();
    form.set("url", " https://images.example/cat.png ");
    await expect(readImageUpload(event(form))).resolves.toEqual({
      buffer: PNG,
      contentType: "image/png",
    });
    expect(fetchRemoteImage).toHaveBeenCalledWith("https://images.example/cat.png", {
      forbiddenHostname: "nojv.example",
    });
  });

  it("retains the local file upload path", async () => {
    const form = new FormData();
    form.set("image", new File([PNG], "cat.png", { type: "image/png" }));
    await expect(readImageUpload(event(form))).resolves.toEqual({
      buffer: PNG,
      contentType: "image/png",
    });
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  it.each(["neither", "both", "duplicate", "empty", "file-url"])(
    "rejects %s input before fetch",
    async (input) => {
      const form = new FormData();
      if (input === "both") {
        form.append("image", new File([PNG], "cat.png", { type: "image/png" }));
        form.append("url", "https://images.example/cat.png");
      }
      if (input === "duplicate") {
        form.append("url", "https://images.example/a.png");
        form.append("url", "https://images.example/b.png");
      }
      if (input === "empty") form.append("url", " ");
      if (input === "file-url") form.append("url", new File([PNG], "cat.png"));
      await expect(readImageUpload(event(form))).rejects.toMatchObject({ status: 400 });
      expect(fetchRemoteImage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["blocked", 400],
    ["invalid_url", 400],
    ["invalid_type", 400],
    ["redirect", 400],
    ["too_large", 413],
    ["upstream", 502],
  ] as const)("reports %s fetch failures", async (code, status) => {
    fetchRemoteImage.mockRejectedValue(new RemoteImageError(code, "Fetch failed"));
    const form = new FormData();
    form.set("url", "https://images.example/cat.png");
    await expect(readImageUpload(event(form))).rejects.toMatchObject({ status });
  });
});
