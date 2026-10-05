export type AssessmentKind = "assignment" | "exam" | "contest";

const commonSubTabs = [
  "problems",
  "submissions",
  "results",
  "plagiarism",
  "audit",
  "clarifications",
  "settings",
] as const;

export type AssessmentSubTab = (typeof commonSubTabs)[number] | "proctoring";
export type AssessmentPrimaryTab = Exclude<AssessmentSubTab, "plagiarism" | "audit">;

export function assessmentPrimaryTab(tab: AssessmentSubTab): AssessmentPrimaryTab {
  if (tab === "plagiarism" || tab === "audit") return "results";
  return tab;
}

export function parseAssessmentSubTab(
  value: string | null,
  kind: AssessmentKind,
  canViewClarifications = true,
): AssessmentSubTab {
  if (value === "clarifications" && !canViewClarifications) return "problems";
  if (kind === "exam" && value === "proctoring") return value;
  return commonSubTabs.includes(value as (typeof commonSubTabs)[number])
    ? (value as AssessmentSubTab)
    : "problems";
}

export function assessmentSubTabHref(currentUrl: URL, nextTab: AssessmentSubTab): string {
  const url = new URL(currentUrl);
  if (nextTab === "problems") url.searchParams.delete("tab");
  else url.searchParams.set("tab", nextTab);

  const query = url.searchParams.toString();
  const search = query ? `?${query}` : "";
  return `${url.pathname}${search}${url.hash}`;
}
