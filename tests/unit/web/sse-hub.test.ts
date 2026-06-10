import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribeMock, unsubscribeMock, onMock, emit } = vi.hoisted(() => {
  let messageCb: ((channel: string, message: string) => void) | null = null;
  return {
    subscribeMock: vi.fn(() => Promise.resolve(1)),
    unsubscribeMock: vi.fn(() => Promise.resolve(1)),
    onMock: vi.fn((event: string, cb: (channel: string, message: string) => void) => {
      if (event === "message") messageCb = cb;
    }),
    emit: (channel: string, message: string) => messageCb?.(channel, message),
  };
});

vi.mock("@nojv/redis", () => ({
  createSubscriber: () => ({
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
    on: onMock,
  }),
}));

import { subscribeSse } from "../../../apps/web/src/lib/server/shared/sse-hub";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sse-hub — process-level shared subscriber with refcounted channels", () => {
  it("subscribes a channel to Redis only once even with multiple clients", () => {
    const ch = `nojv:user:${String(Math.random())}`;
    const a = vi.fn();
    const b = vi.fn();

    const offA = subscribeSse("redis://x", [ch], a);
    const offB = subscribeSse("redis://x", [ch], b);

    // Redis subscribe issued only for the first client of the channel.
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(ch);

    // A message fans out to every handler registered for the channel.
    emit(ch, "hello");
    expect(a).toHaveBeenCalledWith(ch, "hello");
    expect(b).toHaveBeenCalledWith(ch, "hello");

    offA();
    offB();
  });

  it("keeps the channel subscribed until the last client leaves", () => {
    const ch = `nojv:user:${String(Math.random())}`;
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeSse("redis://x", [ch], a);
    const offB = subscribeSse("redis://x", [ch], b);
    vi.clearAllMocks();

    offA();
    // Still one client → no Redis unsubscribe yet.
    expect(unsubscribeMock).not.toHaveBeenCalled();

    // Removed handler no longer receives messages.
    emit(ch, "after-A-left");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(ch, "after-A-left");

    offB();
    // Last client left → Redis unsubscribe issued.
    expect(unsubscribeMock).toHaveBeenCalledWith(ch);
  });
});
