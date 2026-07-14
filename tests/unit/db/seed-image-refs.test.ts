import { describe, expect, it } from "vitest";

import { buildSeedProblemDefs } from "../../../packages/db/prisma/seeds/problems";

const digest = `sha256:${"a".repeat(64)}`;

describe("advanced demo seed image references", () => {
  it("accepts explicit local build references for the development seed", () => {
    const definitions = buildSeedProblemDefs("teacher", {
      run: "nojv-demo-advanced-run:local",
      grade: "nojv-demo-advanced-grade:local",
    });
    const demo = definitions.find(
      (definition) => definition.id === "problem_shell-scripting-lab",
    );

    expect(demo?.advancedConfig?.run.imageRef).toBe("nojv-demo-advanced-run:local");
    expect(demo?.advancedConfig?.grade.imageRef).toBe("nojv-demo-advanced-grade:local");
  });

  it("requires readable tag-plus-digest references outside the local build path", () => {
    expect(
      buildSeedProblemDefs("teacher", {
        run: `registry.nojv.tw/demo/run:v1@${digest}`,
        grade: `registry.nojv.tw/demo/grade:v1@${digest}`,
      }).find((definition) => definition.id === "problem_shell-scripting-lab")?.advancedConfig,
    ).toMatchObject({
      run: { imageRef: `registry.nojv.tw/demo/run:v1@${digest}` },
      grade: { imageRef: `registry.nojv.tw/demo/grade:v1@${digest}` },
    });

    expect(() =>
      buildSeedProblemDefs("teacher", {
        run: "registry.nojv.tw/demo/run:main",
        grade: `registry.nojv.tw/demo/grade:v1@${digest}`,
      }),
    ).toThrow(/run image must be/u);
  });
});
