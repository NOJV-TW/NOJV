export async function postProblemAction(
  problemSlug: string,
  actionName: string,
  data: Record<string, string>
): Promise<void> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) fd.set(key, value);
  const response = await fetch(`/problems/${problemSlug}/edit?/${actionName}`, {
    method: "POST",
    body: fd
  });
  if (!response.ok) throw new Error(`Action ${actionName} failed`);
}
