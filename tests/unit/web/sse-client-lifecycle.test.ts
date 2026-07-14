import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$lib/paraglide/messages.js", () => ({ m: {} }));
vi.mock("$lib/stores/notifications.svelte", () => ({
  notifications: { handleSseEvent: vi.fn() },
}));
vi.mock("$lib/stores/toast", () => ({
  toasts: { success: vi.fn(), info: vi.fn() },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

describe("client SSE clarification channel lifecycle", () => {
  beforeEach(async () => {
    vi.resetModules();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      location: { pathname: "/" },
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  it("reference-counts duplicate channel leases and returns an idempotent disposer", async () => {
    const { connectSSE, disconnectSSE, subscribeClarificationChannel } =
      await import("$lib/stores/sse");

    connectSSE();
    expect(FakeEventSource.instances.map((source) => source.url)).toEqual([
      "/api/events/stream",
    ]);

    const releaseFirst = subscribeClarificationChannel("contest", "contest-1");
    expect(FakeEventSource.instances.at(-1)?.url).toBe(
      "/api/events/stream?clarificationSub=contest%3Acontest-1",
    );
    const instanceCountAfterFirstLease = FakeEventSource.instances.length;

    const releaseSecond = subscribeClarificationChannel("contest", "contest-1");
    expect(FakeEventSource.instances).toHaveLength(instanceCountAfterFirstLease);

    releaseFirst();
    releaseFirst();
    expect(FakeEventSource.instances).toHaveLength(instanceCountAfterFirstLease);

    releaseSecond();
    expect(FakeEventSource.instances.at(-1)?.url).toBe("/api/events/stream");
    disconnectSSE();
  });
});
