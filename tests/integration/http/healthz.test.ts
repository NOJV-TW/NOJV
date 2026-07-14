import { describe, expect, it } from "vitest";

import * as healthz from "../../../apps/web/src/routes/api/healthz/+server";
import { callRoute } from "./_harness";

describe("GET /api/healthz (HTTP boundary harness smoke test)", () => {
  it("returns 200 with ok=true when Postgres + Redis are up", async () => {
    const res = await callRoute({ path: "/api/healthz", module: healthz });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  }, 30_000);
});
