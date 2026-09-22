import type { CourseActivityContext } from "../shared/graded-context";

export type ScoreOverrideContext = CourseActivityContext;
export type ScoreOverrideContextType = ScoreOverrideContext["type"];

export {
  toCourseActivityDbFields as toContextDbFields,
  fromCourseActivityDbFields as fromContextDbFields,
} from "../shared/graded-context";
