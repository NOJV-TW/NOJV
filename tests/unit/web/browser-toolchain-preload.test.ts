import { afterEach, beforeEach, expect, it, vi } from "vitest";

type BrowserLocalRun = typeof import("$lib/services/browser-local-run");
type Progress = { loadedBytes: number; totalBytes: number };
type PrefetchOptions = {
  language: string;
  libcxxPrecompiledHeader?: boolean;
  onProgress?: (progress: Progress) => void;
};

const prefetch = vi.hoisted(() =>
  vi.fn<(sources: readonly unknown[], options: PrefetchOptions) => Promise<void>>(),
);
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  prefetchBrowserToolchain: prefetch,
}));

let browserLocalRun: BrowserLocalRun;

beforeEach(async () => {
  vi.resetModules();
  prefetch.mockReset();
  browserLocalRun = await import("$lib/services/browser-local-run");
});

afterEach(() => {
  vi.useRealTimers();
});

it("prefetches a language's toolchain once through WASM-OJ and forwards its progress", async () => {
  prefetch.mockImplementation(async (_sources, { onProgress }) => {
    onProgress?.({ loadedBytes: 0, totalBytes: 200 });
    onProgress?.({ loadedBytes: 200, totalBytes: 200 });
  });
  const updates: number[] = [];

  await Promise.all([
    browserLocalRun.preloadBrowserToolchain("cpp", (progress) =>
      updates.push(browserLocalRun.browserToolchainPercent(progress)),
    ),
    browserLocalRun.preloadBrowserToolchain("cpp"),
  ]);
  await browserLocalRun.preloadBrowserToolchain("cpp");

  expect(prefetch).toHaveBeenCalledOnce();
  expect(prefetch.mock.calls[0]![0]).toHaveLength(6);
  expect(prefetch.mock.calls[0]![1]).toMatchObject({
    language: "cpp",
    libcxxPrecompiledHeader: true,
  });
  expect(updates).toEqual([0, 100]);
});

it("requests the libc++ PCH only for C++", async () => {
  prefetch.mockResolvedValue(undefined);
  await browserLocalRun.preloadBrowserToolchain("c");
  expect(prefetch.mock.calls[0]![1]).toMatchObject({
    language: "c",
    libcxxPrecompiledHeader: false,
  });
});

it("retries a failed prefetch before succeeding", async () => {
  vi.useFakeTimers();
  prefetch.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(undefined);

  const pending = browserLocalRun.preloadBrowserToolchain("python");
  await vi.advanceTimersByTimeAsync(2_000);

  await expect(pending).resolves.toBeUndefined();
  expect(prefetch).toHaveBeenCalledTimes(2);
});

it("reports the toolchain unavailable after its retries and starts over on the next request", async () => {
  vi.useFakeTimers();
  prefetch.mockRejectedValue(new TypeError("Failed to fetch"));

  const pending = browserLocalRun.preloadBrowserToolchain("python");
  const assertion = expect(pending).rejects.toThrow("Failed to fetch");
  await vi.advanceTimersByTimeAsync(7_000);
  await assertion;
  expect(prefetch).toHaveBeenCalledTimes(3);

  prefetch.mockResolvedValue(undefined);
  await expect(browserLocalRun.preloadBrowserToolchain("python")).resolves.toBeUndefined();
  expect(prefetch).toHaveBeenCalledTimes(4);
});

it("turns byte progress into a bounded percentage", () => {
  expect(browserLocalRun.browserToolchainPercent({ loadedBytes: 0, totalBytes: 0 })).toBe(0);
  expect(browserLocalRun.browserToolchainPercent({ loadedBytes: 50, totalBytes: 200 })).toBe(
    25,
  );
  expect(browserLocalRun.browserToolchainPercent({ loadedBytes: 300, totalBytes: 200 })).toBe(
    100,
  );
});
