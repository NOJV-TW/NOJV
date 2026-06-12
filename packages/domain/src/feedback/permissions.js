import { assessmentRepo, courseMembershipRepo, examRepo } from "@nojv/db";
import { assertContextClosed } from "../shared/context-window";
import { ForbiddenError } from "../shared/errors";
async function isCourseTeacherOrTa(userId, courseId) {
    const membership = await courseMembershipRepo.findByComposite(courseId, userId);
    if (membership?.status !== "active")
        return false;
    return membership.role === "teacher" || membership.role === "ta";
}
export async function canWriteFeedback(actor, context) {
    if (actor.platformRole === "admin")
        return true;
    switch (context.type) {
        case "assignment": {
            const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
            if (!assignment)
                return false;
            return isCourseTeacherOrTa(actor.userId, assignment.courseId);
        }
        case "exam": {
            const exam = await examRepo.findById(context.examId);
            if (!exam)
                return false;
            return isCourseTeacherOrTa(actor.userId, exam.courseId);
        }
    }
}
export async function assertCanViewFeedback(actor, context) {
    if (!(await canWriteFeedback(actor, context))) {
        throw new ForbiddenError("Not permitted to view feedback for this context.");
    }
}
export async function assertCanWriteFeedback(actor, context) {
    await assertCanViewFeedback(actor, context);
    if (actor.platformRole !== "admin") {
        await assertContextClosed(context);
    }
}
