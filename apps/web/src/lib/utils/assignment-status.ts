/**
 * Live status for the assignment settings UI. Mirrors the domain's
 * `deriveStatus`. There is no "archived" state — once closesAt is past
 * the assignment is "closed" and stays read-only.
 */
export type AssignmentLiveStatus = "draft" | "upcoming" | "open" | "closed";

export function deriveAssignmentLiveStatus(
  dbStatus: string,
  opensAtIso: string,
  closesAtIso: string,
  now: Date = new Date(),
): AssignmentLiveStatus {
  if (dbStatus === "draft") return "draft";
  const opensAt = new Date(opensAtIso);
  const closesAt = new Date(closesAtIso);
  if (opensAt > now) return "upcoming";
  if (closesAt < now) return "closed";
  return "open";
}
