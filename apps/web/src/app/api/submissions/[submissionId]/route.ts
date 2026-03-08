import { getSubmissionOperation } from "@nojv/db";
import { NextResponse } from "next/server";

import { getActorContext } from "@/lib/server/actor-context";

export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  try {
    const actor = await getActorContext(request);

    if (!actor) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }

    const { submissionId } = await context.params;
    const submission = await getSubmissionOperation(submissionId);

    if (!submission) {
      return NextResponse.json({ message: "Submission not found." }, { status: 404 });
    }

    if (submission.userId !== actor.userId && actor.platformRole !== "admin") {
      return NextResponse.json({ message: "Submission not found." }, { status: 404 });
    }

    return NextResponse.json({
      result: submission.verdictDetail,
      status: submission.status,
      submissionId: submission.id
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Submission query failed."
      },
      { status: 500 }
    );
  }
}
