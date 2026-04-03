// Re-export from domain — original logic has been moved to @nojv/domain
import { problemDomain } from "@nojv/domain";

export const { getProblemPageData, listEditableProblems, listProblemCards } = problemDomain;
