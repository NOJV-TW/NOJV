import { describe, expect, it } from "vitest";

import { matchesProblemPickerSearch } from "../../../apps/web/src/lib/utils/problem-picker";

const problem = {
  difficulty: "medium" as const,
  displayId: 42,
  id: "cuid_problem_42",
  judgeType: "standard" as const,
  status: "published" as const,
  tags: ["graph", "search"],
  title: "Shortest Path",
  type: "full_source" as const,
  visibility: "public" as const,
};

describe("matchesProblemPickerSearch", () => {
  it.each(["42", "#42", "shortest", "graph", "cuid_problem_42"])("matches %s", (query) => {
    expect(matchesProblemPickerSearch(problem, query)).toBe(true);
  });

  it("does not treat a bare # as a display ID search", () => {
    expect(matchesProblemPickerSearch(problem, "#")).toBe(false);
  });

  it("does not show candidates before a search is entered", () => {
    expect(matchesProblemPickerSearch(problem, "")).toBe(false);
  });

  it("does not match an unrelated query", () => {
    expect(matchesProblemPickerSearch(problem, "99")).toBe(false);
  });
});
