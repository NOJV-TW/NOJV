<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import AssessmentGradesTab from "$lib/components/features/coursework/AssessmentGradesTab.svelte";
  import type { AssignmentResults } from "$lib/server/results/assignment";
  import type { courseDomain } from "@nojv/application";

  interface Props {
    data: AssignmentResults;
    matrix: courseDomain.SubmissionsMatrix;
    assignmentId: string;
    oncellclick?: ((userId: string, problemId: string) => void) | undefined;
  }

  let { data, matrix, assignmentId, oncellclick }: Props = $props();
</script>

<AssessmentGradesTab
  {matrix}
  stats={data}
  csvDownloadName={`assignment-${assignmentId}-grades.csv`}
  dataSlot="assignment-grade-matrix"
  {oncellclick}
  labels={{
    heading: m.assignmentDetail_matrixHeading,
    hint: m.assignmentDetail_matrixHint,
    meta: m.assignmentDetail_matrixMeta,
    student: m.assignmentDetail_matrixStudent,
    total: m.assignmentDetail_matrixTotal,
    maxPoints: m.assignmentDetail_matrixMaxPoints,
    attempts: m.assignmentDetail_matrixAttempts,
    searchPlaceholder: m.assignmentDetail_matrixSearchPlaceholder,
    exportCsv: m.assignmentDetail_matrixExportCsv,
    empty: m.assignmentDetail_matrixEmpty,
    legendAc: m.assignmentDetail_legendAc,
    legendPartial: m.assignmentDetail_legendPartial,
    legendZero: m.assignmentDetail_legendZero,
    legendEmpty: m.assignmentDetail_legendEmpty,
    legendPractice: m.assignmentDetail_legendPractice,
    practiceSummary: m.assignmentDetail_matrixPracticeSummary,
    paginationLabel: m.assignmentDetail_matrixPaginationLabel,
    prev: m.assignmentDetail_matrixPrev,
    next: m.assignmentDetail_matrixNext,
    gradeCellTitle: m.matrix_gradeCellTitle,
  }}
/>
