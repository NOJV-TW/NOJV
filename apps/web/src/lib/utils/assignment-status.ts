/**
 * Live status for the assignment settings UI. Mirrors the domain's
 * `deriveStatus`, with "archived" layered on top — the existing
 * `AssignmentDetail.status` collapses archived into closed/open/upcoming
 * depending on date, which is fine for students but ambiguous for the
 * manager settings tab that wants to offer a different control surface
 * per lifecycle state.
 */
export type AssignmentLiveStatus = "draft" | "upcoming" | "open" | "closed" | "archived";

export function deriveAssignmentLiveStatus(
  dbStatus: string,
  opensAtIso: string,
  closesAtIso: string,
  now: Date = new Date(),
): AssignmentLiveStatus {
  if (dbStatus === "archived") return "archived";
  if (dbStatus === "draft") return "draft";
  const opensAt = new Date(opensAtIso);
  const closesAt = new Date(closesAtIso);
  if (opensAt > now) return "upcoming";
  if (closesAt < now) return "closed";
  return "open";
}
