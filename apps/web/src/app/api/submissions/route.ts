import { submissionDraftSchema } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getActorContext } from "@/lib/server/actor-context";
import { createQueuedSubmissionRecord } from "@/lib/server/poc-persistence";
import { dispatchSubmissionJob } from "@/lib/server/queue";

export async function POST(request: Request) {
  try {
    const actor = await getActorContext(request);
    const payload = submissionDraftSchema.parse(await request.json());
    const submission = await createQueuedSubmissionRecord(payload, actor);
    await dispatchSubmissionJob({
      draft: payload,
      submissionId: submission.id
    });

    return NextResponse.json(
      {
        pollUrl: `/api/submissions/${submission.id}`,
        status: submission.status,
        submissionId: submission.id
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid submission payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Submission dispatch failed.";

    return NextResponse.json(
      {
        message
      },
      { status: 500 }
    );
  }
}
