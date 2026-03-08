import { workspaceRunRequestSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { createQueuedWorkspaceRunRecord } from "@/lib/server/poc-persistence";
import { dispatchWorkspaceRunJob } from "@/lib/server/queue";

export async function POST(request: Request) {
  try {
    const actor = await getActorContext(request);

    if (!actor) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }

    const payload = workspaceRunRequestSchema.parse(await request.json());
    const workspaceRun = await createQueuedWorkspaceRunRecord(payload, actor);
    await dispatchWorkspaceRunJob({
      request: payload,
      workspaceRunId: workspaceRun.id
    });

    return NextResponse.json(
      {
        pollUrl: `/api/workspace/runs/${workspaceRun.id}`,
        status: workspaceRun.status,
        workspaceRunId: workspaceRun.id
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid workspace run payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Workspace execution failed.";

    return NextResponse.json(
      {
        message
      },
      { status: 500 }
    );
  }
}
