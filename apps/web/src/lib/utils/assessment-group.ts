export type AssessmentGroupStatus =
  "live" | "running" | "open" | "draft" | "upcoming" | "closed" | "ended";

export type AssessmentGroupIcon = "active" | "draft" | "upcoming" | "ended";

export function assessmentGroupIcon(status: AssessmentGroupStatus): AssessmentGroupIcon {
  if (status === "live" || status === "running" || status === "open") return "active";
  if (status === "draft") return "draft";
  if (status === "closed" || status === "ended") return "ended";
  return "upcoming";
}
