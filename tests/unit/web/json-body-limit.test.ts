import { describe, expect, it } from "vitest";

import { assertJsonBodyWithinLimit, JSON_BODY_LIMIT_BYTES } from "$lib/server/shared/api-handler";

function eventWithContentLength(value: string | null) {
  return {
    request: { headers: { get: (k: string) => (k === "content-length" ? value : null) } },
  } as never;
}

describe("assertJsonBodyWithinLimit", () => {
  it("passes when content-length is under the limit", () => {
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength("500"))).not.toThrow();
  });

  it("passes when content-length header is absent", () => {
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength(null))).not.toThrow();
  });

  it("throws when content-length exceeds the default 1MB limit", () => {
    expect(() =>
      assertJsonBodyWithinLimit(eventWithContentLength(String(JSON_BODY_LIMIT_BYTES + 1))),
    ).toThrow();
  });

  it("honors a caller-supplied limit", () => {
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength("2000"), 1000)).toThrow();
    expect(() => assertJsonBodyWithinLimit(eventWithContentLength("800"), 1000)).not.toThrow();
  });
});
