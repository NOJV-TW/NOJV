import { describe, expect, it } from "vitest";

import { callRoute } from "./_harness";
import * as submissions from "../../../apps/web/src/routes/api/submissions/+server";
import * as rejudges from "../../../apps/web/src/routes/api/rejudges/+server";
import * as overrides from "../../../apps/web/src/routes/api/overrides/+server";
import * as plagiarismFlags from "../../../apps/web/src/routes/api/plagiarism-flags/+server";
import * as clarifications from "../../../apps/web/src/routes/api/clarifications/+server";

const cases = [
  {
    name: "POST /api/submissions",
    path: "/api/submissions",
    module: submissions,
    method: "POST",
  },
  { name: "POST /api/rejudges", path: "/api/rejudges", module: rejudges, method: "POST" },
  { name: "POST /api/overrides", path: "/api/overrides", module: overrides, method: "POST" },
  {
    name: "POST /api/plagiarism-flags",
    path: "/api/plagiarism-flags",
    module: plagiarismFlags,
    method: "POST",
  },
  {
    name: "GET /api/clarifications",
    path: "/api/clarifications?contextType=contest&contextId=ctst_x",
    module: clarifications,
    method: "GET",
  },
];

describe("high-risk API routes reject unauthenticated requests (auth-wiring gate)", () => {
  for (const c of cases) {
    it(`${c.name} → 401 without a session`, async () => {
      const res = await callRoute({
        path: c.path,
        method: c.method,
        module: c.module,
        user: null,
        ...(c.method === "GET" ? {} : { body: {} }),
      });
      expect(res.status).toBe(401);
    });
  }
});
