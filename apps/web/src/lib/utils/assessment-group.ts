export type AssessmentGroupStatus =
  "live" | "running" | "open" | "upcoming" | "closed" | "ended";

export type AssessmentGroupIcon = "active" | "upcoming" | "ended";

export function assessmentGroupIcon(status: AssessmentGroupStatus): AssessmentGroupIcon {
  if (status === "live" || status === "running" || status === "open") return "active";
  if (status === "closed" || status === "ended") return "ended";
  return "upcoming";
}
