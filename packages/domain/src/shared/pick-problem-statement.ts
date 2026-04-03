export function pickProblemStatement(
  statements:
    | {
        bodyMarkdown: string;
        inputFormat?: string;
        locale: string;
        outputFormat?: string;
        title: string;
      }[]
    | undefined,
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
