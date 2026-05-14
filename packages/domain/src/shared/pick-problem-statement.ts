interface ProblemStatement {
  bodyMarkdown: string;
  inputFormat?: string;
  locale: string;
  outputFormat?: string;
  title: string;
}

/**
 * Selects the best statement for a locale: prefer an exact locale match,
 * otherwise fall back to the first row, otherwise `null`. Centralising this
 * lets callers treat the result as a single nullable instead of chaining
 * `??` across undefined/missing-locale/empty-array branches.
 */
function selectStatement(
  statements: ProblemStatement[] | undefined,
  locale: string,
): ProblemStatement | null {
  if (!statements) return null;
  const match = statements.find((statement) => statement.locale === locale);
  if (match) return match;
  return statements[0] ?? null;
}

export function pickProblemStatement(
  statements: ProblemStatement[] | undefined,
  locale: string,
  fallbackTitle: string,
  fallbackStatement: string,
) {
  const localized = selectStatement(statements, locale);

  return {
    inputFormat: localized?.inputFormat ?? "",
    outputFormat: localized?.outputFormat ?? "",
    statement: localized?.bodyMarkdown ?? fallbackStatement,
    title: localized?.title ?? fallbackTitle,
  };
}
