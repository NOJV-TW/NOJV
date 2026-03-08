import { getWorkspaceRunOperation } from "@nojv/db";
import { NextResponse } from "next/server";

import { getActorContext } from "@/lib/server/actor-context";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const actor = await getActorContext(request);

    if (!actor) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }

    const { runId } = await context.params;
    const workspaceRun = await getWorkspaceRunOperation(runId);

    if (!workspaceRun) {
      return NextResponse.json({ message: "Workspace run not found." }, { status: 404 });
    }

    if (workspaceRun.userId !== actor.userId && actor.platformRole !== "admin") {
      return NextResponse.json({ message: "Workspace run not found." }, { status: 404 });
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
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Workspace run query failed."
      },
      { status: 500 }
    );
  }
}
