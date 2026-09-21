export const examSubTabKeys = [
  "problems",
  "submissions",
  "results",
  "plagiarism",
  "proctoring",
  "credentials",
  "settings",
  "clarifications",
  "audit",
] as const;

export type ExamSubTab = (typeof examSubTabKeys)[number];
export type ExamPrimaryTab = Exclude<ExamSubTab, "plagiarism" | "audit" | "credentials">;

export function examPrimaryTab(tab: ExamSubTab): ExamPrimaryTab {
  if (tab === "plagiarism" || tab === "audit") return "results";
  if (tab === "credentials") return "proctoring";
  return tab;
}

export function parseExamSubTab(value: string | null): ExamSubTab {
  return value && examSubTabKeys.includes(value as ExamSubTab)
    ? (value as ExamSubTab)
    : "problems";
}

export function examSubTabHref(currentUrl: URL, nextTab: ExamSubTab): string {
  const url = new URL(currentUrl);
  if (nextTab === "problems") url.searchParams.delete("tab");
  else url.searchParams.set("tab", nextTab);

  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}
