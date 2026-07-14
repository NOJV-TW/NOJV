import { describe, expect, it } from "vitest";

import { updateDeployImageValues } from "../../../scripts/update-deploy-image-values.mjs";

const digest = (digit: string) => `sha256:${digit.repeat(64)}`;
const input = `image:
  registry: ghcr.io
  tag: latest
  digests:
    web: ""
    worker: ""
    sandbox: ""
    migrator: ""
other: true
`;

describe("deploy image value publication", () => {
  it("atomically records one release tag and every verified component digest", () => {
    expect(
      updateDeployImageValues(input, {
        tag: "abc123",
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toBe(`image:
  registry: ghcr.io
  tag: abc123
  digests:
    web: ${digest("1")}
    worker: ${digest("2")}
    sandbox: ${digest("3")}
    migrator: ${digest("4")}
other: true
`);
  });

  it("rejects malformed digests and incomplete values layouts", () => {
    expect(() =>
      updateDeployImageValues(input, {
        tag: "abc123",
        digests: {
          web: "sha256:unverified",
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toThrow(/web digest/u);

    expect(() =>
      updateDeployImageValues(input.replace('    sandbox: ""\n', ""), {
        tag: "abc123",
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toThrow(/exactly one image\.digests\.sandbox/u);
  });
});
