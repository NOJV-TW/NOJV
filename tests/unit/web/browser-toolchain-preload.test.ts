import { afterEach, beforeEach, expect, it, vi } from "vitest";

type BrowserLocalRun = typeof import("$lib/services/browser-local-run");

const CHUNK = new Uint8Array(1024 * 1024);
let browserLocalRun: BrowserLocalRun;

function body(bytes: number): ReadableStream<Uint8Array> {
  let remaining = bytes;
  return new ReadableStream({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const size = Math.min(CHUNK.byteLength, remaining);
      remaining -= size;
      controller.enqueue(CHUNK.subarray(0, size));
    },
  });
}

function stubFetch(respond: (url: URL) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: URL) => respond(url));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function assetBytes(url: URL): number {
  const asset = [
    ...browserLocalRun.browserToolchainAssets("c"),
    ...browserLocalRun.browserToolchainAssets("cpp"),
  ].find((candidate) =>
    url.pathname.endsWith(candidate.path.slice(candidate.path.lastIndexOf("/") + 1)),
  );
  if (!asset) throw new Error(`Unexpected toolchain request ${url.href}`);
  return asset.bytes;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("location", { href: "https://nojv.test/problems/1" });
  browserLocalRun = await import("$lib/services/browser-local-run");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("downloads each toolchain asset once at its digest-addressed Worker URL and reports progress", async () => {
  const fetchMock = stubFetch((url) => new Response(body(assetBytes(url))));
  const progress: number[] = [];

  await Promise.all([
    browserLocalRun.preloadBrowserToolchain("c", (update) =>
      progress.push(browserLocalRun.browserToolchainPercent(update)),
    ),
    browserLocalRun.preloadBrowserToolchain("c"),
  ]);

  const assets = browserLocalRun.browserToolchainAssets("c");
  expect(fetchMock).toHaveBeenCalledTimes(assets.length);
  for (const asset of assets) {
    const basename = asset.path.slice(asset.path.lastIndexOf("/") + 1);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      `https://nojv.test/wasm-oj/toolchains/${basename}?sha256=${asset.sha256}`,
    );
  }
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(100);

  await browserLocalRun.preloadBrowserToolchain("c");
  expect(fetchMock).toHaveBeenCalledTimes(assets.length);
});

it("retries a failed download before reporting the toolchain as unavailable", async () => {
  vi.useFakeTimers();
  let failures = 1;
  const fetchMock = stubFetch((url) => {
    if (failures > 0) {
      failures -= 1;
      throw new TypeError("Failed to fetch");
    }
    return new Response(body(assetBytes(url)));
  });

  const pending = browserLocalRun.preloadBrowserToolchain("c");
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(pending).resolves.toBeUndefined();
  expect(fetchMock.mock.calls.length).toBeGreaterThan(
    browserLocalRun.browserToolchainAssets("c").length,
  );
});

it("rejects after its retries and downloads again on the next request", async () => {
  vi.useFakeTimers();
  const fetchMock = stubFetch(() => new Response("blocked", { status: 403 }));

  const pending = browserLocalRun.preloadBrowserToolchain("c");
  const assertion = expect(pending).rejects.toThrow("(403)");
  await vi.advanceTimersByTimeAsync(7_000);
  await assertion;
  const attempts = fetchMock.mock.calls.length;

  fetchMock.mockImplementation(async (url: URL) => new Response(body(assetBytes(url))));
  await expect(browserLocalRun.preloadBrowserToolchain("c")).resolves.toBeUndefined();
  expect(fetchMock.mock.calls.length).toBeGreaterThan(attempts);
});

it("rejects a truncated asset instead of treating the toolchain as cached", async () => {
  vi.useFakeTimers();
  stubFetch((url) => new Response(body(assetBytes(url) - 1)));

  const pending = browserLocalRun.preloadBrowserToolchain("c");
  const assertion = expect(pending).rejects.toThrow("incomplete");
  await vi.advanceTimersByTimeAsync(7_000);
  await assertion;
});

it("selects only the release libc++ PCH for C++ and no PCH for C", () => {
  const paths = (language: "c" | "cpp") =>
    browserLocalRun.browserToolchainAssets(language).map(({ path }) => path);

  expect(paths("cpp").some((path) => path.endsWith(".cpp-release.pch.gz.bin"))).toBe(true);
  expect(paths("cpp").some((path) => path.endsWith(".libcxx-pch.json"))).toBe(true);
  expect(paths("cpp").some((path) => path.endsWith(".cpp-debug.pch.gz.bin"))).toBe(false);
  expect(paths("c").some((path) => /\.pch\.gz\.bin$|\.libcxx-pch\.json$/.test(path))).toBe(
    false,
  );
  expect(paths("c").some((path) => path.endsWith(".webc.gz.bin"))).toBe(true);
});
