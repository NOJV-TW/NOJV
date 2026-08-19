export type AssignmentManageTabKey =
  | "problems"
  | "submissions"
  | "results"
  | "plagiarism"
  | "settings"
  | "clarifications"
  | "audit";

interface AssignmentManageTabLabels {
  problems: string;
  submissions: string;
  results: string;
  plagiarism: string;
  settings: string;
  clarifications: string;
  audit: string;
}

export function buildAssignmentManageTabs(
  labels: AssignmentManageTabLabels,
  clarificationEnabled: boolean,
): { key: AssignmentManageTabKey; label: string }[] {
  return [
    { key: "problems", label: labels.problems },
    { key: "submissions", label: labels.submissions },
    { key: "results", label: labels.results },
    { key: "plagiarism", label: labels.plagiarism },
    { key: "settings", label: labels.settings },
    ...(clarificationEnabled
      ? [{ key: "clarifications" as const, label: labels.clarifications }]
      : []),
    { key: "audit", label: labels.audit },
  ];
}
