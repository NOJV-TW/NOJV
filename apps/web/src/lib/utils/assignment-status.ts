import { serverNow } from "#lib/utils/datetime.js";

export type AssignmentLiveStatus = "draft" | "upcoming" | "open" | "closed";

export function deriveAssignmentLiveStatus(
  dbStatus: string,
  opensAtIso: string,
  closesAtIso: string,
  now: Date = new Date(serverNow()),
): AssignmentLiveStatus {
  if (dbStatus === "draft") return "draft";
  const opensAt = new Date(opensAtIso);
  const closesAt = new Date(closesAtIso);
  if (opensAt > now) return "upcoming";
  if (closesAt <= now) return "closed";
  return "open";
}
