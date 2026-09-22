import type { CourseActivityContext } from "../shared/graded-context";

export type FeedbackContext = CourseActivityContext;

export type FeedbackContextType = FeedbackContext["type"];

export {
  toCourseActivityDbFields as toContextDbFields,
  fromCourseActivityDbFields as fromContextDbFields,
} from "../shared/graded-context";
