import { workspaceRunRequestSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { withAuth } from "@/lib/server/api-handler";
import { createQueuedWorkspaceRunRecord } from "@/lib/server/poc-persistence";
import { dispatchWorkspaceRunJob } from "@/lib/server/queue";

export const POST = withAuth(async (request, actor) => {
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
});
