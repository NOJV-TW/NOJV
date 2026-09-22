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

export type AssessmentSubTab = (typeof commonSubTabs)[number] | "proctoring" | "credentials";
export type AssessmentPrimaryTab = Exclude<
  AssessmentSubTab,
  "plagiarism" | "audit" | "credentials"
>;

export function assessmentPrimaryTab(tab: AssessmentSubTab): AssessmentPrimaryTab {
  if (tab === "plagiarism" || tab === "audit") return "results";
  if (tab === "credentials") return "proctoring";
  return tab;
}

export function parseAssessmentSubTab(
  value: string | null,
  kind: AssessmentKind,
  canViewClarifications = true,
): AssessmentSubTab {
  if (value === "clarifications" && !canViewClarifications) return "problems";
  if (kind === "exam" && (value === "proctoring" || value === "credentials")) return value;
  return commonSubTabs.includes(value as (typeof commonSubTabs)[number])
    ? (value as AssessmentSubTab)
    : "problems";
}

export function assessmentSubTabHref(currentUrl: URL, nextTab: AssessmentSubTab): string {
  const url = new URL(currentUrl);
  if (nextTab === "problems") url.searchParams.delete("tab");
  else url.searchParams.set("tab", nextTab);

  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}
