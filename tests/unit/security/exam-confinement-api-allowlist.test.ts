import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isExamForbiddenApiRequest } from "$lib/server/exam-lock";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "../../../apps/web/src/routes/api");

type ExamClassification = "exam-safe" | "exam-confined" | "exam-scoped";

const REVIEWED_GET_ROUTES: Record<string, ExamClassification> = {
  "/api/admin/healthz": "exam-safe",
  "/api/auth/[...path]": "exam-safe",
  "/api/clarifications": "exam-safe",
  "/api/contests/[id]/scoreboard": "exam-confined",
  "/api/contests/[id]/scoreboard/chart": "exam-confined",
  "/api/events/stream": "exam-safe",
  "/api/exams/[examId]/ip-violations": "exam-safe",
  "/api/feedback": "exam-safe",
  "/api/healthz": "exam-safe",
  "/api/notifications": "exam-safe",
  "/api/notifications/unread-count": "exam-safe",
  "/api/openapi.internal.json": "exam-safe",
  "/api/openapi.public.json": "exam-safe",
  "/api/overrides": "exam-safe",
  "/api/plagiarism/[assignmentId]/reports": "exam-safe",
  "/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]": "exam-safe",
  "/api/posts/[id]": "exam-confined",
  "/api/posts/[id]/comments": "exam-confined",
  "/api/problems": "exam-safe",
  "/api/problems/[id]/bundle": "exam-safe",
  "/api/problems/[id]/posts": "exam-confined",
  "/api/problems/[id]/storage-usage": "exam-safe",
  "/api/problems/advanced-scaffold": "exam-safe",
  "/api/registry/token": "exam-safe",
  "/api/rejudges/[workflowId]": "exam-safe",
  "/api/storage/avatars/[userId]": "exam-safe",
  "/api/storage/problem-images/[problemId]/[filename]": "exam-safe",
  "/api/storage/user-content-images/[userId]/[filename]": "exam-safe",
  "/api/submissions": "exam-scoped",
  "/api/submissions/[id]": "exam-scoped",
  "/api/submissions/[id]/source": "exam-scoped",
};

function serverDirToUrl(dir: string): string {
  const rel = path.relative(apiRoot, dir).split(path.sep).join("/");
  return rel === "" ? "/api" : `/api/${rel}`;
}

function getServerRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "+server.ts") {
        const source = readFileSync(full, "utf8");
        if (/export\s+(?:const|async function|function)\s+GET\b/.test(source)) {
          routes.push(serverDirToUrl(dir));
        }
      }
    }
  };
  walk(apiRoot);
  return routes.sort();
}

describe("every data-returning GET API route is a reviewed exam-confinement decision", () => {
  const liveRoutes = getServerRoutes();

  it("the exam page-lock gate allow-lists ALL /api/ paths, so each new GET route must be classified exam-safe or exam-confined before it can ship", () => {
    const unreviewed = liveRoutes.filter((route) => !(route in REVIEWED_GET_ROUTES));
    expect(
      unreviewed,
      `New GET +server.ts route(s) are not classified in REVIEWED_GET_ROUTES. ` +
        `A human must mark each "exam-safe" (no exam data leak) or "exam-confined" ` +
        `(must be blocked during exams, like the contest scoreboard): ${unreviewed.join(", ")}`,
    ).toEqual([]);
  });

  it("the allow-list does not list GET routes that no longer exist", () => {
    const live = new Set(liveRoutes);
    const stale = Object.keys(REVIEWED_GET_ROUTES).filter((route) => !live.has(route));
    expect(
      stale,
      `Remove deleted routes from REVIEWED_GET_ROUTES: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("every exam-confined route is actually blocked by the request gate", () => {
    const confined = Object.entries(REVIEWED_GET_ROUTES)
      .filter(([, classification]) => classification === "exam-confined")
      .map(([route]) => route.replace(/\[[^\]]+\]/g, "x1"));
    expect(confined.length).toBeGreaterThan(0);
    const unblocked = confined.filter((route) => !isExamForbiddenApiRequest(route, "GET"));
    expect(
      unblocked,
      `Route(s) classified "exam-confined" but not blocked by isExamForbiddenApiRequest — ` +
        `extend the gate in apps/web/src/lib/server/exam-lock.ts: ${unblocked.join(", ")}`,
    ).toEqual([]);
  });

  it("only permits reviewed submission methods while an exam is active", () => {
    expect(isExamForbiddenApiRequest("/api/submissions", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/submissions/sub_1", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/submissions/sub_1/source", "GET")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/submissions", "POST")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/submissions/sub_1/rejudge", "POST")).toBe(false);
    expect(isExamForbiddenApiRequest("/api/submissions", "DELETE")).toBe(true);
    expect(isExamForbiddenApiRequest("/api/submissions/sub_1/source", "POST")).toBe(true);
  });
});
