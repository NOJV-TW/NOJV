import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { examDomain } from "@nojv/domain";

const bodySchema = z.object({
  examId: z.string().min(1)
});

// Idempotent: re-entering an existing session returns 200; a fresh start returns 201.
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const body = bodySchema.parse(await event.request.json());

  const result = await examDomain.session.startSessionWithGate(actor, {
    examId: body.examId
  });

  return json(
    {
      sessionId: result.session.id,
      examId: result.session.examId,
      startedAt: result.session.startedAt.toISOString(),
      endsAt: result.exam.endsAt.toISOString()
    },
    { status: result.created ? 201 : 200 }
  );
});
