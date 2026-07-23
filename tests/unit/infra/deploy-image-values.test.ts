import { describe, expect, it } from "vitest";

import { updateDeployImageValues } from "../../../scripts/update-deploy-image-values.mjs";

const digest = (digit: string) => `sha256:${digit.repeat(64)}`;
const releaseSha = "a".repeat(40);
const imageTag = "v1.2.3";
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
        sourceSha: releaseSha,
        tag: imageTag,
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
  tag: ${imageTag}
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
        sourceSha: releaseSha,
        tag: imageTag,
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
        sourceSha: releaseSha,
        tag: imageTag,
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toThrow(/exactly one image\.digests\.sandbox/u);
  });

  it.each(["latest", "main", "v1", "v1.2", "v1.2.3-rc.1", "1.2.3"])(
    "rejects the non-release deployment tag %s",
    (tag) => {
      expect(() =>
        updateDeployImageValues(input, {
          sourceSha: releaseSha,
          tag,
          digests: {
            web: digest("1"),
            worker: digest("2"),
            sandbox: digest("3"),
            migrator: digest("4"),
          },
        }),
      ).toThrow(/vX\.Y\.Z/u);
    },
  );

  it("rejects a malformed source commit", () => {
    expect(() =>
      updateDeployImageValues(input, {
        sourceSha: "main",
        tag: imageTag,
        digests: {
          web: digest("1"),
          worker: digest("2"),
          sandbox: digest("3"),
          migrator: digest("4"),
        },
      }),
    ).toThrow(/40-character release commit SHA/u);
  });

  it("rejects a values layout without exactly one release source identity", () => {
    expect(() =>
      updateDeployImageValues(input.replace('  sourceSha: ""\n', ""), {
        sourceSha: releaseSha,
        tag: imageTag,
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
