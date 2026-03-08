import { describe, expect, it } from "vitest";

import { getProblemDetail } from "../src/lib/demo-data";

describe("presentation copy", () => {
  it("does not expose placeholder wording on public problem content", () => {
    const problem = getProblemDetail("distributed-labyrinth");

    expect(problem).toBeDefined();
    expect(problem?.statement).not.toMatch(/POC|placeholder|demo/i);
    expect(problem?.summary).not.toMatch(/POC|placeholder|demo/i);
  });
});
