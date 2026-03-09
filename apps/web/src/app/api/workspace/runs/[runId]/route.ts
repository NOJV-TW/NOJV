import { getWorkspaceRunOperation } from "@nojv/db";
import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/server/api-errors";
import { withAuthParams } from "@/lib/server/api-handler";

export const GET = withAuthParams<{ runId: string }>(async (_request, actor, { runId }) => {
  const workspaceRun = await getWorkspaceRunOperation(runId);

  if (!workspaceRun) {
    throw new NotFoundError("Workspace run not found.");
  }

  if (workspaceRun.userId !== actor.userId && actor.platformRole !== "admin") {
    throw new NotFoundError("Workspace run not found.");
  }

  return NextResponse.json({
    result:
      workspaceRun.finishedAt && workspaceRun.startedAt
        ? {
            durationMs: Math.max(
              0,
              workspaceRun.finishedAt.getTime() - workspaceRun.startedAt.getTime()
            ),
            exitCode: workspaceRun.exitCode,
            stderr: workspaceRun.stderr ?? "",
            status: workspaceRun.status,
            stdout: workspaceRun.stdout ?? ""
          }
        : null,
    status: workspaceRun.status,
    workspaceRunId: workspaceRun.id
  });
});
