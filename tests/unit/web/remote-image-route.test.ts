import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiConsume, fetchConsume, readRemoteImage, cacheRemoteImage, fetchRemoteImage } =
  vi.hoisted(() => ({
    apiConsume: vi.fn(),
    fetchConsume: vi.fn(),
    readRemoteImage: vi.fn(),
    cacheRemoteImage: vi.fn(),
    fetchRemoteImage: vi.fn(),
  }));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  apiRateLimiter: { consume: apiConsume },
  writeApiRateLimiter: { consume: vi.fn() },
  registryTokenRateLimiter: { consume: vi.fn() },
  remoteAssetFetchRateLimiter: { consume: fetchConsume },
}));

vi.mock("$lib/server/storage/remote-image", () => ({
  readRemoteImage,
  cacheRemoteImage,
  isRemoteImageNotFoundError: (error: unknown) =>
    error instanceof Error && error.name === "NoSuchKey",
}));

vi.mock("$lib/server/remote-image", () => ({
  RemoteImageError: class RemoteImageError extends Error {},
  fetchRemoteImage,
  normalizeRemoteImageUrl: (rawUrl: string) => new URL(rawUrl),
}));

const { GET } = await import("$lib/../routes/api/images/proxy/+server");

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const IMAGE = { body: PNG, contentType: "image/png" };

function event(query = "?url=https%3A%2F%2Fimages.example%2Fcat.png"): RequestEvent {
  const url = new URL(`https://nojv.example/api/images/proxy${query}`);
  return {
    getClientAddress: () => "203.0.113.5",
    locals: { sessionUser: null, apiTokenActor: null },
    request: new Request(url),
    url,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiConsume.mockResolvedValue("allowed");
  fetchConsume.mockResolvedValue("allowed");
  readRemoteImage.mockResolvedValue(IMAGE);
  cacheRemoteImage.mockResolvedValue(IMAGE);
  fetchRemoteImage.mockResolvedValue(IMAGE);
});

describe("remote image proxy route", () => {
  it("serves a cached image without an outbound request", async () => {
    const response = await GET(event());

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(fetchRemoteImage).not.toHaveBeenCalled();
    expect(fetchConsume).not.toHaveBeenCalled();
  });

  it("fetches and atomically caches a miss", async () => {
    const missing = new Error("NoSuchKey");
    missing.name = "NoSuchKey";
    readRemoteImage.mockRejectedValue(missing);

    const response = await GET(event());

    expect(response.status).toBe(200);
    expect(fetchConsume).toHaveBeenCalledOnce();
    expect(fetchRemoteImage).toHaveBeenCalledWith(
      "https://images.example/cat.png",
      expect.objectContaining({ forbiddenHostname: "nojv.example" }),
    );
    expect(cacheRemoteImage).toHaveBeenCalledWith(
      "https://images.example/cat.png",
      PNG,
      "image/png",
    );
  });

  it("fails closed for a missing URL or unavailable miss limiter", async () => {
    await expect(GET(event(""))).rejects.toMatchObject({ status: 400 });

    const missing = new Error("NoSuchKey");
    missing.name = "NoSuchKey";
    readRemoteImage.mockRejectedValue(missing);
    fetchConsume.mockResolvedValue("unavailable");
    await expect(GET(event())).rejects.toMatchObject({ status: 503 });
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  it("redirects an absolute first-party image without contacting the network", async () => {
    await expect(
      GET(event("?url=https%3A%2F%2Fnojv.example%2Fapi%2Fstorage%2Fimage.png")),
    ).rejects.toMatchObject({
      status: 307,
      location: "https://nojv.example/api/storage/image.png",
    });
    expect(readRemoteImage).not.toHaveBeenCalled();
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });
});
