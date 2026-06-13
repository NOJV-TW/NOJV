import {
  INTERACTIVE_RUN_MARKER,
  INTERACTIVE_VALIDATE_MARKER,
  parseMarkedLine,
  parseValidatorFeedback,
  VALIDATOR_EXIT_ACCEPT,
  VALIDATOR_EXIT_WRONG,
} from "@nojv/core";
import { describe, expect, it } from "vitest";

describe("validator exit codes", () => {
  it("exposes the DOMjudge/Kattis accept and wrong codes", () => {
    expect(VALIDATOR_EXIT_ACCEPT).toBe(42);
    expect(VALIDATOR_EXIT_WRONG).toBe(43);
  });

  it("maps exit 42 to AC", () => {
    expect(parseValidatorFeedback(42, {}).verdict).toBe("AC");
  });

  it("maps exit 43 to WA", () => {
    expect(parseValidatorFeedback(43, {}).verdict).toBe("WA");
  });

  it.each([0, 1, 7, 255])("maps non-protocol exit %i to SE", (code) => {
    expect(parseValidatorFeedback(code, {}).verdict).toBe("SE");
  });
});

describe("checker is AC/WA only — score.txt is ignored (no partial scoring)", () => {
  it("never reports a numeric score, even when score.txt is present", () => {
    const files = { scoreTxt: "0.85" } as unknown as Parameters<
      typeof parseValidatorFeedback
    >[1];
    const outcome = parseValidatorFeedback(42, files);
    expect("score" in outcome).toBe(false);
  });

  it("an AC verdict carries no score field", () => {
    expect("score" in parseValidatorFeedback(42, {})).toBe(false);
  });
});

describe("validator feedback messages", () => {
  it("surfaces trimmed team and judge messages on their own fields", () => {
    const outcome = parseValidatorFeedback(43, {
      teamMessage: "  too slow\n",
      judgeMessage: "\twrong on case 3 ",
    });
    expect(outcome.teamMessage).toBe("too slow");
    expect(outcome.judgeMessage).toBe("wrong on case 3");
  });

  it("omits empty or whitespace-only messages", () => {
    const outcome = parseValidatorFeedback(42, {
      teamMessage: "",
      judgeMessage: "   \n\t",
    });
    expect(outcome.teamMessage).toBeUndefined();
    expect(outcome.judgeMessage).toBeUndefined();
  });

  it("does not leak the judge message onto the team field", () => {
    const outcome = parseValidatorFeedback(43, { judgeMessage: "internal note" });
    expect(outcome.judgeMessage).toBe("internal note");
    expect(outcome.teamMessage).toBeUndefined();
  });

  it("does not leak the team message onto the judge field", () => {
    const outcome = parseValidatorFeedback(43, { teamMessage: "nice try" });
    expect(outcome.teamMessage).toBe("nice try");
    expect(outcome.judgeMessage).toBeUndefined();
  });
});

describe("parseMarkedLine (interactive run/validate markers)", () => {
  it("extracts the JSON payload following a marker", () => {
    const stderr = `some logging\n${INTERACTIVE_RUN_MARKER}{"exitCode":0,"timeMs":12}\n`;
    expect(parseMarkedLine(stderr, INTERACTIVE_RUN_MARKER)).toEqual({
      exitCode: 0,
      timeMs: 12,
    });
  });

  it("uses the LAST occurrence of the marker", () => {
    const stderr = `${INTERACTIVE_VALIDATE_MARKER}{"verdict":"WA"}\n${INTERACTIVE_VALIDATE_MARKER}{"verdict":"AC"}`;
    expect(parseMarkedLine(stderr, INTERACTIVE_VALIDATE_MARKER)).toEqual({ verdict: "AC" });
  });

  it("returns null when the marker is absent", () => {
    expect(parseMarkedLine("no markers here", INTERACTIVE_RUN_MARKER)).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    expect(
      parseMarkedLine(`${INTERACTIVE_RUN_MARKER}not json`, INTERACTIVE_RUN_MARKER),
    ).toBeNull();
  });

  it("returns null on an empty payload", () => {
    expect(parseMarkedLine(`${INTERACTIVE_RUN_MARKER}\n`, INTERACTIVE_RUN_MARKER)).toBeNull();
  });
});
