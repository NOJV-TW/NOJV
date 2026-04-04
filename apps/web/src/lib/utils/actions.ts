export async function postProblemAction(
  problemId: string,
  actionName: string,
  data: Record<string, string>
): Promise<void> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) fd.set(key, value);
  const response = await fetch(`/problems/${problemId}/edit?/${actionName}`, {
    method: "POST",
    body: fd
  });
  if (!response.ok) throw new Error(`Action ${actionName} failed`);
}
