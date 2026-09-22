import { ValidationError } from "./errors";

export type GradedContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string };

export type GradedContextType = GradedContext["type"];

export type CourseActivityContext = Exclude<GradedContext, { type: "contest" }>;

export type CourseActivityDbFields =
  { assessmentId: string; examId?: undefined } | { examId: string; assessmentId?: undefined };

export function toCourseActivityDbFields(ctx: CourseActivityContext): CourseActivityDbFields {
  return ctx.type === "assignment"
    ? { assessmentId: ctx.assignmentId }
    : { examId: ctx.examId };
}

export function fromCourseActivityDbFields(row: {
  assessmentId: string | null;
  examId: string | null;
}): CourseActivityContext {
  if (row.assessmentId !== null) {
    return { type: "assignment", assignmentId: row.assessmentId };
  }
  if (row.examId !== null) {
    return { type: "exam", examId: row.examId };
  }
  throw new ValidationError("Row has no course activity id.");
}

export function toContextDbFields(ctx: GradedContext): {
  contextType: GradedContextType;
  contextId: string;
} {
  switch (ctx.type) {
    case "assignment":
      return { contextType: "assignment", contextId: ctx.assignmentId };
    case "exam":
      return { contextType: "exam", contextId: ctx.examId };
    case "contest":
      return { contextType: "contest", contextId: ctx.contestId };
  }
}

export function fromContextDbFields(row: {
  contextType: string;
  contextId: string;
}): GradedContext {
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
