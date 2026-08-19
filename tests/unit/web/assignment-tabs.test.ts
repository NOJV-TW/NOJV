import { describe, expect, it } from "vitest";
import { buildAssignmentManageTabs } from "../../../apps/web/src/routes/(app)/assignments/[assignmentId]/tabs";

describe("assignment management tabs", () => {
  it("shows the submissions tab without a count", () => {
    const tabs = buildAssignmentManageTabs(
      {
        problems: "題目",
        submissions: "提交紀錄",
        results: "成績",
        plagiarism: "抄襲偵測",
        settings: "設定",
        clarifications: "提問",
        audit: "稽核",
      },
      false,
    );

    expect(tabs.find((tab) => tab.key === "submissions")).toEqual({
      key: "submissions",
      label: "提交紀錄",
    });
  });
});
