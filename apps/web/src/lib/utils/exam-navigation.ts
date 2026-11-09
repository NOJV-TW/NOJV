import type { BeforeNavigate } from "$app/navigation";

export function recordExamNavigationAttempt(navigation: BeforeNavigate): void {
  const target = navigation.to;
  if (
    navigation.shallow ||
    navigation.willUnload ||
    !target?.params?.examId ||
    !target.route.id?.startsWith("/(app)/exams/[examId]")
  )
    return;
  void fetch(`/api/exams/${encodeURIComponent(target.params.examId)}/entry-attempt`, {
    method: "POST",
    headers: { "x-requested-with": "fetch" },
  }).catch(() => undefined);
}
