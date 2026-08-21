import { describe, expect, it } from "vitest";

import { formatJudgeOutput } from "$lib/utils/judge-output";

describe("formatJudgeOutput", () => {
  it("removes ANSI styling, normalizes paths, and preserves useful diagnostics", () => {
    expect(
      formatJudgeOutput(
        "\u001b[31merror:\u001b[0m /project/main.cpp:1:1\r\n\u001b[1;31mboom\u001b[0m",
      ),
    ).toBe("error: main.cpp:1:1\nboom");
  });
});
