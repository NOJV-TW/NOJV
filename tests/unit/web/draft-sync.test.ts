// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerDraftSync, DRAFT_SYNC_INTERVAL_MS } from "$lib/services/draft-sync";

const context = { type: "exam" as const, examId: "exam_1" };

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function puts() {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => ({
      body: JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
      keepalive: (init as RequestInit).keepalive,
    }));
}

async function loadedSync() {
  fetchMock.mockResolvedValueOnce(
    respond(200, {
      drafts: [{ language: "c", sourceCode: "server", sourceFiles: null, updatedAt: "x" }],
    }),
  );
  const sync = createServerDraftSync(context, "problem_1");
  expect((await sync.load())?.[0]?.sourceCode).toBe("server");
  return sync;
}

describe("server draft sync", () => {
  it("loads the drafts once and scopes the request to the context and problem", async () => {
    const sync = await loadedSync();
    await sync.load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost");
    expect(JSON.parse(url.searchParams.get("context")!)).toEqual(context);
    expect(url.searchParams.get("problemId")).toBe("problem_1");
    sync.dispose();
  });

  it("never pushes when the initial load failed, so it cannot overwrite another device", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const sync = createServerDraftSync(context, "problem_1");
    expect(await sync.load()).toBeNull();
    sync.schedule("c", { sourceCode: "starter" }, () => {});
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_INTERVAL_MS);
    expect(puts()).toEqual([]);
    sync.dispose();
  });

  it("coalesces edits per language and acknowledges the saved content", async () => {
    const sync = await loadedSync();
    fetchMock.mockResolvedValue(respond(200, { updatedAt: "now" }));
    const saved = vi.fn();
    sync.schedule("c", { sourceCode: "a" }, saved);
    sync.schedule("c", { sourceCode: "ab" }, saved);
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_INTERVAL_MS - 1);
    expect(puts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(puts().map((p) => p.body)).toEqual([
      { context, problemId: "problem_1", language: "c", sourceCode: "ab" },
    ]);
    expect(saved).toHaveBeenCalledTimes(1);
    sync.dispose();
  });

  it("retries server errors but drops rejected drafts", async () => {
    const sync = await loadedSync();
    fetchMock.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));
    const saved = vi.fn();
    sync.schedule("c", { sourceCode: "retry me" }, saved);
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_INTERVAL_MS);
    expect(puts()).toHaveLength(2);
    expect(saved).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(respond(403));
    sync.schedule("c", { sourceCode: "exam ended" }, saved);
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_INTERVAL_MS * 3);
    expect(puts()).toHaveLength(3);
    expect(saved).toHaveBeenCalledTimes(1);
    sync.dispose();
  });

  it("flushes with keepalive when the page is hidden", async () => {
    const sync = await loadedSync();
    fetchMock.mockResolvedValue(respond(200));
    sync.schedule("c", { sourceCode: "leaving" }, () => {});
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(puts()).toEqual([
      {
        body: { context, problemId: "problem_1", language: "c", sourceCode: "leaving" },
        keepalive: true,
      },
    ]);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    sync.dispose();
  });
});
