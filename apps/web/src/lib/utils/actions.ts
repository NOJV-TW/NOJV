export async function postProblemAction(
  problemId: string,
  actionName: string,
  data: Record<string, string>,
): Promise<void> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) fd.set(key, value);
  const response = await fetch(`/problems/${problemId}/edit?/${actionName}`, {
    method: "POST",
    body: fd,
  });
  if (!response.ok) throw new Error(`Action ${actionName} failed`);
}

export async function fetchTestcaseContent(
  problemId: string,
  testcaseId: string,
): Promise<{ input: string; output: string | null }> {
  const response = await fetch(`/api/problems/${problemId}/testcases/${testcaseId}`);
  if (!response.ok) throw new Error("Failed to load testcase content");
  return (await response.json()) as { input: string; output: string | null };
}
