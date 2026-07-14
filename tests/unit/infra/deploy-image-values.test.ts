import { describe, expect, it } from "vitest";

import { updateDeployImageValues } from "../../../scripts/update-deploy-image-values.mjs";

const digest = (digit: string) => `sha256:${digit.repeat(64)}`;
const releaseSha = "a".repeat(40);
const input = `release:
  sourceSha: ""
image:
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
        tag: releaseSha,
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toBe(`release:
  sourceSha: ${releaseSha}
image:
  registry: ghcr.io
  tag: ${releaseSha}
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
        tag: releaseSha,
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
        tag: releaseSha,
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toThrow(/exactly one image\.digests\.sandbox/u);
  });

  it.each(["latest", "main", "master", "local", "abc123", "A".repeat(40)])(
    "rejects the non-SHA deployment tag %s",
    (tag) => {
      expect(() =>
        updateDeployImageValues(input, {
          tag,
          digests: {
            web: digest("1"),
            worker: digest("2"),
            sandbox: digest("3"),
            migrator: digest("4"),
          },
        }),
      ).toThrow(/40-character release commit SHA/u);
    },
  );

  it("rejects a values layout without exactly one release source identity", () => {
    expect(() =>
      updateDeployImageValues(input.replace('  sourceSha: ""\n', ""), {
        tag: releaseSha,
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toThrow(/exactly one release\.sourceSha/u);
  });
});
