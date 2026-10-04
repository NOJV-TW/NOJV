export function hidesProblemsBeforeStart(
  isManager: boolean,
  startsAt: Date,
  now: Date,
): boolean {
  return !isManager && now < startsAt;
}
