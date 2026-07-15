import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$lib/services/http", () => ({ fetchWithCsrf: vi.fn() }));

const snapshotItem = {
  id: "clarification-1",
  contextType: "contest" as const,
  contextId: "contest-1",
  problemId: null,
  questionText: "old question",
  answerText: null,
  state: "pending" as const,
  askedBy: null,
  answeredBy: null,
  answeredAt: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  isPublic: false,
  isMine: true,
};

describe("clarifications store snapshot lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it("does not let a delayed HTTP snapshot overwrite a newer SSE event", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response),
    );
    const { createClarificationsStore } = await import("$lib/stores/clarifications.svelte");
    const store = createClarificationsStore("contest", "contest-1");

    const initializing = store.init();
    store.handleSse({
      type: "clarification",
      action: "created",
      payload: { ...snapshotItem, questionText: "new question" },
    });
    resolveResponse(
      new Response(JSON.stringify({ items: [snapshotItem] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await initializing;

    expect(store.items).toHaveLength(1);
    expect(store.items[0]?.questionText).toBe("new question");
  });

  it("does not publish a snapshot after its generation is aborted", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response),
    );
    const { createClarificationsStore } = await import("$lib/stores/clarifications.svelte");
    const store = createClarificationsStore("contest", "contest-1");
    const controller = new AbortController();

    const initializing = store.init(controller.signal);
    controller.abort();
    resolveResponse(new Response(JSON.stringify({ items: [snapshotItem] }), { status: 200 }));
    await initializing;

    expect(store.items).toEqual([]);
  });
});
