export type ExamListStatus = "draft" | "upcoming" | "running" | "ended";

export interface ExamListGroup<T extends { status: ExamListStatus }> {
  key: ExamListStatus;
  items: T[];
}

const GROUP_ORDER: readonly ExamListStatus[] = ["draft", "running", "upcoming", "ended"];

export function groupExamRows<T extends { status: ExamListStatus }>(
  exams: readonly T[],
): ExamListGroup<T>[] {
  return GROUP_ORDER.flatMap((key) => {
    const items = exams.filter((exam) => exam.status === key);
    return items.length > 0 ? [{ key, items }] : [];
  });
}
