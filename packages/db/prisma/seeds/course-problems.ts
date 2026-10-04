export const COURSE_PROBLEM_SOURCES = [
  "problem_warmup-sum",
  "problem_process-log-parser",
  "problem_add-two-numbers",
  "problem_graph-docking",
  "problem_fork-bomb-safeguard",
  "problem_memory-leak-forensics",
  "problem_float-compare",
  "problem_shell-scripting-lab",
] as const;

export function courseProblemId(sourceId: (typeof COURSE_PROBLEM_SOURCES)[number]): string {
  return `${sourceId}-course`;
}
