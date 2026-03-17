import { describe, expect, it } from "vitest";

import { buildEditorSessionId } from "../../../packages/core/src/index";

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
