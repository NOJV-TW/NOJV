import { describe, expect, it } from "vitest";
import { groupExamRows } from "#lib/components/features/course/exam/exam-list-groups.js";

const rows = [
  {
    id: "draft",
    status: "draft" as const,
    title: "Draft exam",
  },
  {
    id: "upcoming",
    status: "upcoming" as const,
    title: "Published upcoming exam",
  },
];

describe("exam list groups", () => {
  it("keeps drafts in their own group instead of upcoming", () => {
    const groups = groupExamRows(rows);

    expect(groups.map((group) => group.key)).toEqual(["draft", "upcoming"]);
    expect(groups[0]?.items.map((exam) => exam.id)).toEqual(["draft"]);
    expect(groups[1]?.items.map((exam) => exam.id)).toEqual(["upcoming"]);
  });
});
