import { courseDomain, examDomain, proctoringDomain, NotFoundError } from "@nojv/application";
import type { RequestHandler } from "./$types";
import { isCourseManager, requireApiAuth } from "#lib/server/auth.js";
import { getClientIp } from "#lib/server/shared/client-ip.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const examId = event.params.examId;
  if (!examId) throw new NotFoundError("Exam not found.");
  const exam = await examDomain.getExamById(examId);
  if (!exam) throw new NotFoundError("Exam not found.");
  const course = await courseDomain.getCourseHeaderById(exam.courseId, actor.userId);
  if (!course) throw new NotFoundError("Exam not found.");
  if (isCourseManager(actor, course)) return new Response(null, { status: 204 });

  const cached = event.locals.examGate;
  const verdict =
    cached?.entityId === examId
      ? cached.verdict
      : await proctoringDomain.checkProctoringGate({
          entityKind: "exam",
          entityId: examId,
          userId: actor.userId,
          ip: getClientIp(event),
          recordIpViolation: true,
        });
  if (!verdict.ok) {
    return Response.json({ message: "Exam entry unavailable." }, { status: 403 });
  }
  return new Response(null, { status: 204 });
});
