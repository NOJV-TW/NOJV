import { ValidationError } from "../shared/errors";
export function toContextDbFields(ctx) {
    switch (ctx.type) {
        case "assignment":
            return { assessmentId: ctx.assignmentId };
        case "exam":
            return { examId: ctx.examId };
    }
}
export function fromContextDbFields(row) {
    if (row.assessmentId !== null) {
        return { type: "assignment", assignmentId: row.assessmentId };
    }
    if (row.examId !== null) {
        return { type: "exam", examId: row.examId };
    }
    throw new ValidationError("Submission feedback row has no context id.");
}
