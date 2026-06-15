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

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(ch);

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
    expect(unsubscribeMock).not.toHaveBeenCalled();

    emit(ch, "after-A-left");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(ch, "after-A-left");

    offB();
    expect(unsubscribeMock).toHaveBeenCalledWith(ch);
  });
});
