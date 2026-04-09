import { DEFAULT_LOCALE } from "@nojv/core";

interface ProblemStatement {
  bodyMarkdown: string;
  inputFormat?: string;
  locale: string;
  outputFormat?: string;
  title: string;
}

export function pickProblemStatement(
  statements: ProblemStatement[] | undefined,
  locale: string,
  fallbackTitle: string,
  fallbackStatement: string
) {
  const localized =
    statements?.find((statement) => statement.locale === locale) ?? statements?.[0] ?? null;

  return {
    inputFormat: localized?.inputFormat ?? "",
    outputFormat: localized?.outputFormat ?? "",
    statement: localized?.bodyMarkdown ?? fallbackStatement,
    title: localized?.title ?? fallbackTitle
  };
}

/**
 * Convenience wrapper: given a problem with an `id`, `summary`, and
 * `statements`, return the localized view using the problem's own id/summary
 * as fallback values.
 */
export function localizeProblem(
  problem: { id: string; summary: string; statements?: ProblemStatement[] },
  locale: string = DEFAULT_LOCALE
) {
  return pickProblemStatement(problem.statements, locale, problem.id, problem.summary);
}
