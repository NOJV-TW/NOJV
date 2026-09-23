import { describe, expect, it } from "vitest";

import { load } from "../../../apps/web/src/routes/(app)/+layout.server";

interface FakeEvent {
  locals: { session: unknown; sessionUser: unknown };
  cookies: { get: (name: string) => string | undefined };
  url: URL;
}

function fakeEvent(over: Partial<FakeEvent["locals"]>, cookie?: string): FakeEvent {
  return {
    locals: { session: null, sessionUser: null, ...over },
    cookies: { get: () => cookie },
    url: new URL("http://localhost/"),
  };
}

describe("(app) layout auth gate", () => {
  it("redirects unauthenticated requests to /signin", () => {
    let thrown: unknown;
    try {
      load(fakeEvent({ session: null }) as never);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ status: 302, location: "/signin" });
  });

  it("returns the session user (and editor language) when authenticated", () => {
    const result = load(
      fakeEvent(
        { session: { id: "s", userId: "u1" }, sessionUser: { id: "u1" } },
        "python",
      ) as never,
    );
    expect(result).toMatchObject({ user: { id: "u1" }, editorLanguage: "python" });
  });

  it("gives each user a stable 256-bit draft key that differs from other users", () => {
    const keyFor = (userId: string) =>
      (
        load(
          fakeEvent({ session: { id: "s", userId }, sessionUser: { id: userId } }) as never,
        ) as {
          draftCipherKey: string;
        }
      ).draftCipherKey;
    expect(keyFor("u1")).toBe(keyFor("u1"));
    expect(keyFor("u1")).not.toBe(keyFor("u2"));
    expect(Buffer.from(keyFor("u1"), "base64")).toHaveLength(32);
  });
});
