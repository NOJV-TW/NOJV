interface ProblemStatement {
  bodyMarkdown: string;
  inputFormat?: string;
  locale: string;
  outputFormat?: string;
  title: string;
}

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
