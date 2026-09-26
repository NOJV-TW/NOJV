import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  dropped: vi.fn(),
  unsubscribe: vi.fn(),
  release: vi.fn(),
}));

vi.mock("$lib/server/env", () => ({ getWebEnv: () => ({ REDIS_URL: "redis://test" }) }));
vi.mock("$lib/server/shared/sse-hub", () => ({ subscribeSse: () => mocks.unsubscribe }));
vi.mock("$lib/server/shared/sse-slot", () => ({
  acquireSseSlot: () => true,
  releaseSseSlot: mocks.release,
}));
vi.mock("$lib/server/metrics", () => ({
  sseConnectionDuration: { record: mocks.record },
  sseConnectionDroppedTotal: { add: mocks.dropped },
}));

const { createSseResponse } =
  await import("../../../apps/web/src/lib/server/shared/sse-response");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SSE response close accounting", () => {
  it("counts a cancelled stream as a client abort, not a dropped connection", async () => {
    const response = createSseResponse({
      channels: ["notifications:user-1"],
      slotType: "events",
      userId: "user-1",
      request: new Request("http://localhost/api/events/stream"),
    });

    await response.body?.cancel();

    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.record.mock.calls[0]?.[1]).toEqual({ close_reason: "client_abort" });
    expect(mocks.dropped).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
