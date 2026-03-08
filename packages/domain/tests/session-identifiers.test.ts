import { describe, expect, it } from "vitest";

import { buildEditorSessionId, buildWorkspaceSessionId } from "../src/index";

describe("buildWorkspaceSessionId", () => {
  it("derives a stable assignment session id from course context", () => {
    expect(
      buildWorkspaceSessionId({
        assessmentSlug: "hw1-process-trace",
        courseSlug: "os-lab-spring-2026",
        mode: "assignment"
      })
    ).toBe("ws_assignment_os-lab-spring-2026_hw1-process-trace");
  });

  it("keeps contest sessions distinct from practice sessions", () => {
    expect(
      buildWorkspaceSessionId({
        contestSlug: "spring-qualifier-2026",
        mode: "contest"
      })
    ).toBe("ws_contest_spring-qualifier-2026");
  });
});

describe("buildEditorSessionId", () => {
  it("keeps contest telemetry distinct from practice telemetry for the same problem", () => {
    expect(
      buildEditorSessionId({
        contestSlug: "spring-qualifier-2026",
        problemSlug: "warmup-sum"
      })
    ).toBe("editor_warmup-sum_contest_spring-qualifier-2026");
  });

  it("includes course assessment context for assignment editors", () => {
    expect(
      buildEditorSessionId({
        assessmentSlug: "hw1-process-trace",
        courseSlug: "os-lab-spring-2026",
        problemSlug: "process-log-parser"
      })
    ).toBe("editor_process-log-parser_os-lab-spring-2026_hw1-process-trace");
  });
});
