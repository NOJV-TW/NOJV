import { deserialize } from "$app/forms";
import { m } from "$lib/paraglide/messages.js";

function actionFailureMessage(result: ReturnType<typeof deserialize>): string {
  if (result.type === "failure" && typeof result.data?.error === "string") {
    return result.data.error;
  }
  if (result.type === "error") {
    const error: unknown = result.error;
    if (typeof error === "object" && error !== null && "message" in error) {
      if (typeof error.message === "string") return error.message;
    }
  }
  return m.error_unexpected();
}

export async function submitFormAction(
  action: string,
  fields: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const response = await fetch(action, { method: "POST", body });
  const result = deserialize(await response.text());
  if (result.type !== "success") throw new Error(actionFailureMessage(result));
  return result.data ?? {};
}

export function postProblemAction(
  problemId: string,
  actionName: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  return submitFormAction(`/problems/${problemId}/edit?/${actionName}`, fields);
}

export async function fetchTestcaseContent(
  problemId: string,
  testcaseId: string,
): Promise<{ input: string; output: string | null }> {
  const response = await fetch(`/api/problems/${problemId}/testcases/${testcaseId}`);
  if (!response.ok) throw new Error("Failed to load testcase content");
  return (await response.json()) as { input: string; output: string | null };
}
