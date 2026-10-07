import { describe, expect, it } from "vitest";

import {
  checkerCaseVerdict,
  interactiveCaseVerdict,
  MAX_FEEDBACK_LEN,
  truncateUtf8,
} from "@nojv/core";

describe("checkerCaseVerdict", () => {
  const exited = (code: number) => ({ termination: "exited", code });

  it("maps exit 42 to AC and keeps the trimmed team message", () => {
    expect(checkerCaseVerdict(exited(42), "  looks good\n")).toEqual({
      verdict: "AC",
      teamMessage: "looks good",
    });
  });

  it("maps exit 42 without a team message to a bare AC", () => {
    expect(checkerCaseVerdict(exited(42))).toEqual({ verdict: "AC" });
  });

  it("maps exit 43 to WA", () => {
    expect(checkerCaseVerdict(exited(43), "off by one")).toEqual({
      verdict: "WA",
      teamMessage: "off by one",
    });
  });

  it("omits an empty team message", () => {
    expect(checkerCaseVerdict(exited(43), " \n")).toEqual({ verdict: "WA" });
  });

  it("maps any other exit code to SE without a team message", () => {
    expect(checkerCaseVerdict(exited(1), "partial")).toEqual({ verdict: "SE" });
  });

  it("maps a checker that did not exit to SE", () => {
    expect(checkerCaseVerdict({ termination: "logical-time-limit", code: 42 }, "late")).toEqual(
      {
        verdict: "SE",
      },
    );
  });

  it("caps the team message at the feedback limit", () => {
    const result = checkerCaseVerdict(exited(43), "x".repeat(MAX_FEEDBACK_LEN + 50));
    expect(result.teamMessage).toHaveLength(MAX_FEEDBACK_LEN);
  });

  it("caps an astral team message without splitting a surrogate pair", () => {
    const result = checkerCaseVerdict(exited(43), `a${"😀".repeat(MAX_FEEDBACK_LEN)}`);
    expect(result.teamMessage).toHaveLength(MAX_FEEDBACK_LEN - 1);
    expect(result.teamMessage?.endsWith("😀")).toBe(true);
  });
});

describe("interactiveCaseVerdict", () => {
  const exited = (code: number) => ({ termination: "exited", code });

  it("lets a contestant time limit win over an interactor accept", () => {
    expect(
      interactiveCaseVerdict({
        contestant: { termination: "logical-time-limit", code: 0 },
        interactor: exited(42),
      }),
    ).toEqual({ verdict: "TLE" });
  });

  it("maps a contestant crash to RE", () => {
    expect(
      interactiveCaseVerdict({ contestant: exited(1), interactor: exited(43) }, "eof"),
    ).toEqual({ verdict: "RE" });
  });

  it("maps interactor 43 to WA with the team message", () => {
    expect(
      interactiveCaseVerdict({ contestant: exited(0), interactor: exited(43) }, "wrong guess"),
    ).toEqual({ verdict: "WA", teamMessage: "wrong guess" });
  });

  it("maps interactor 42 to AC", () => {
    expect(interactiveCaseVerdict({ contestant: exited(0), interactor: exited(42) })).toEqual({
      verdict: "AC",
    });
  });

  it("maps an interactor that did not exit to SE", () => {
    expect(
      interactiveCaseVerdict(
        { contestant: exited(0), interactor: { termination: "trap", code: 0 } },
        "partial",
      ),
    ).toEqual({ verdict: "SE" });
  });

  it("lets an interactor protocol failure win over a contestant failure", () => {
    expect(
      interactiveCaseVerdict({
        contestant: { termination: "memory-limit", code: 0 },
        interactor: exited(1),
      }),
    ).toEqual({ verdict: "SE" });
  });
});

describe("truncateUtf8", () => {
  it("returns short text unchanged", () => {
    expect(truncateUtf8("abc", 3)).toBe("abc");
  });

  it("cuts ASCII at the exact byte count", () => {
    expect(truncateUtf8("abcdef", 4)).toBe("abcd");
  });

  it("never splits a multibyte character", () => {
    expect(truncateUtf8("中中中", 4)).toBe("中");
    expect(truncateUtf8("中中中", 6)).toBe("中中");
  });

  it("never splits a surrogate pair", () => {
    expect(truncateUtf8("a😀b", 4)).toBe("a");
  });
});
