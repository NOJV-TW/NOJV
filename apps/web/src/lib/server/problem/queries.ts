// Re-export from domain — original logic has been moved to @nojv/domain
import { problemDomain } from "@nojv/domain";

export const {
  getProblemPageData,
  getProblemTestcaseSets,
  listEditableProblems,
  listProblemCards,
  updateProblemRecord,
  updateProblemTemplates,
  createProblemTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
  deleteProblemRecord
} = problemDomain;
