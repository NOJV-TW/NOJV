import {
  workspaceRunRequestSchema,
  workspaceRunResultSchema,
  type WorkspaceRunRequest,
  type WorkspaceRunResult
} from "@nojv/domain";

export interface RemoteSandboxConfig {
  baseUrl: string;
  sharedToken: string;
}

export async function runRemoteSandboxCommand(
  payload: WorkspaceRunRequest,
  config: RemoteSandboxConfig
): Promise<WorkspaceRunResult> {
  const request = workspaceRunRequestSchema.parse(payload);
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/execute`, {
    body: JSON.stringify(request),
    headers: {
      Authorization: `Bearer ${config.sharedToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    const errorPayload = (await response.json()) as { message?: string };
    throw new Error(errorPayload.message ?? "Remote sandbox execution failed.");
  }

  return workspaceRunResultSchema.parse(await response.json());
}
