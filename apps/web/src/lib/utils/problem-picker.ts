import type { problemDomain } from "@nojv/application";

type ProblemPickerCandidate = problemDomain.ProblemPickerCandidate;

export function matchesProblemPickerSearch(
  problem: ProblemPickerCandidate,
  search: string,
): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return false;

  const displayIdQuery = query.startsWith("#") ? query.slice(1) : query;
  return (
    problem.title.toLowerCase().includes(query) ||
    problem.id.toLowerCase().includes(query) ||
    (displayIdQuery.length > 0 &&
      problem.displayId !== null &&
      String(problem.displayId).includes(displayIdQuery)) ||
    problem.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}
