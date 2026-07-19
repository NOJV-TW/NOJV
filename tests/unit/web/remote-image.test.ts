import { describe, expect, it, vi } from "vitest";

import {
  RemoteImageError,
  fetchRemoteImage,
  type RemoteImageRequest,
  type RemoteImageResolver,
} from "$lib/server/remote-image";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function publicResolver(addresses = [{ address: "203.0.114.10", family: 4 as const }]) {
  return vi.fn<RemoteImageResolver>().mockResolvedValue(addresses);
}

function imageRequest(body = PNG) {
  return vi.fn<RemoteImageRequest>().mockResolvedValue({ status: 200, body });
}

describe("remote image retrieval", () => {
  it.each([
    "http://images.example/image.png",
    "https://user:secret@images.example/image.png",
    "https://images.example:444/image.png",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(
      fetchRemoteImage(url, { resolve: publicResolver(), request: imageRequest() }),
    ).rejects.toBeInstanceOf(RemoteImageError);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "198.18.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("rejects non-public address %s", async (address) => {
    const family = address.includes(":") ? (6 as const) : (4 as const);
    await expect(
      fetchRemoteImage("https://images.example/image.png", {
        resolve: publicResolver([{ address, family }]),
        request: imageRequest(),
      }),
    ).rejects.toMatchObject({ code: "blocked" });
  });

  it("rejects a hostname if DNS mixes public and private answers", async () => {
    const request = imageRequest();
    await expect(
      fetchRemoteImage("https://images.example/image.png", {
        resolve: publicResolver([
          { address: "203.0.114.10", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ]),
        request,
      }),
    ).rejects.toMatchObject({ code: "blocked" });
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates redirects before making the next request", async () => {
    const request = vi.fn<RemoteImageRequest>().mockResolvedValueOnce({
      status: 302,
      location: "https://127.0.0.1/private.png",
      body: Buffer.alloc(0),
    });

    await expect(
      fetchRemoteImage("https://images.example/image.png", {
        resolve: publicResolver(),
        request,
      }),
    ).rejects.toMatchObject({ code: "blocked" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects redirect chains beyond the fixed limit", async () => {
    const request = vi.fn<RemoteImageRequest>().mockImplementation(async (url) => ({
      status: 302,
      location: `https://images.example${url.pathname}x`,
      body: Buffer.alloc(0),
    }));

    await expect(
      fetchRemoteImage("https://images.example/image.png", {
        resolve: publicResolver(),
        request,
      }),
    ).rejects.toMatchObject({ code: "redirect" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects oversized and non-image responses", async () => {
    await expect(
      fetchRemoteImage("https://images.example/large.png", {
        resolve: publicResolver(),
        request: imageRequest(Buffer.alloc(5 * 1024 * 1024 + 1)),
      }),
    ).rejects.toMatchObject({ code: "too_large" });

    await expect(
      fetchRemoteImage("https://images.example/not-image", {
        resolve: publicResolver(),
        request: imageRequest(Buffer.from("not an image")),
      }),
    ).rejects.toMatchObject({ code: "invalid_type" });
  });

  it("returns a magic-byte verified image and pins the selected public address", async () => {
    const resolve = publicResolver([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "203.0.114.10", family: 4 },
    ]);
    const request = imageRequest();

    await expect(
      fetchRemoteImage("https://images.example/image.png#ignored", { resolve, request }),
    ).resolves.toEqual({ body: PNG, contentType: "image/png" });
    expect(request).toHaveBeenCalledWith(new URL("https://images.example/image.png"), {
      address: "203.0.114.10",
      family: 4,
    });
  });
});
