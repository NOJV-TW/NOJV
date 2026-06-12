import { ValidationError } from "./errors";
export function toContextDbFields(ctx) {
    switch (ctx.type) {
        case "assignment":
            return { contextType: "assignment", contextId: ctx.assignmentId };
        case "exam":
            return { contextType: "exam", contextId: ctx.examId };
        case "contest":
            return { contextType: "contest", contextId: ctx.contestId };
    }
}
export function fromContextDbFields(row) {
    switch (row.contextType) {
        case "assignment":
            return { type: "assignment", assignmentId: row.contextId };
        case "exam":
            return { type: "exam", examId: row.contextId };
        case "contest":
            return { type: "contest", contestId: row.contextId };
        default:
            throw new ValidationError(`Unknown contextType: ${row.contextType}`);
    }
}
