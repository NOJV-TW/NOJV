import { describe, expect, it } from "vitest";

import {
  assessmentSubTabHref,
  parseAssessmentSubTab,
  assessmentPrimaryTab,
} from "$lib/components/features/coursework/assessment-tab-state";

describe("assessment tab state", () => {
  it.each(["assignment", "exam"] as const)("restores shared %s leaf URLs", (kind) => {
    for (const tab of [
      "problems",
      "submissions",
      "results",
      "plagiarism",
      "audit",
      "clarifications",
      "settings",
    ] as const) {
      expect(parseAssessmentSubTab(tab, kind)).toBe(tab);
    }
    expect(parseAssessmentSubTab("unknown", kind)).toBe("problems");
    expect(parseAssessmentSubTab(null, kind)).toBe("problems");
    expect(parseAssessmentSubTab("clarifications", kind, false)).toBe("problems");
  });

  it("keeps exam-only views out of assignments", () => {
    for (const tab of ["credentials", "proctoring"] as const) {
      expect(parseAssessmentSubTab(tab, "exam")).toBe(tab);
      expect(parseAssessmentSubTab(tab, "assignment")).toBe("problems");
    }
  });

  it("keeps child views under their primary management section", () => {
    expect(assessmentPrimaryTab("credentials")).toBe("proctoring");
    expect(assessmentPrimaryTab("proctoring")).toBe("proctoring");
    expect(assessmentPrimaryTab("plagiarism")).toBe("results");
    expect(assessmentPrimaryTab("audit")).toBe("results");
    expect(assessmentPrimaryTab("settings")).toBe("settings");
  });

  it.each(["assignments", "exams"])("preserves query parameters and hashes in %s", (path) => {
    const currentUrl = new URL(
      `https://nojv.test/${path}/item_1?tab=problems&view=compact#activity`,
    );
    expect(assessmentSubTabHref(currentUrl, "submissions")).toBe(
      `/${path}/item_1?tab=submissions&view=compact#activity`,
    );
    expect(assessmentSubTabHref(currentUrl, "problems")).toBe(
      `/${path}/item_1?view=compact#activity`,
    );
    expect(currentUrl.searchParams.get("tab")).toBe("problems");
  });
});
