<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";

  export type SubmissionsMatrixData = courseDomain.SubmissionsMatrix;
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import MatrixView from "../submissions/MatrixView.svelte";

  interface Props {
    matrix: SubmissionsMatrixData;
    courseId: string;
    assignmentId: string;
    class?: string;
  }

  let { matrix, courseId, assignmentId, class: className }: Props = $props();
</script>

<MatrixView
  {matrix}
  csvDownloadName={`assignment-${assignmentId}-matrix.csv`}
  dataSlot="assignment-submissions-matrix"
  showRoleFilter
  viewHref={(userId) => `/courses/${courseId}/members?student=${userId}`}
  class={className}
  labels={{
    heading: m.assignmentDetail_matrixHeading,
    hint: m.assignmentDetail_matrixHint,
    meta: m.assignmentDetail_matrixMeta,
    student: m.assignmentDetail_matrixStudent,
    total: m.assignmentDetail_matrixTotal,
    maxPoints: m.assignmentDetail_matrixMaxPoints,
    attempts: m.assignmentDetail_matrixAttempts,
    searchPlaceholder: m.assignmentDetail_matrixSearchPlaceholder,
    sortTotalDesc: m.assignmentDetail_matrixSortTotalDesc,
    sortHandleAsc: m.assignmentDetail_matrixSortHandleAsc,
    sortNameAsc: m.assignmentDetail_matrixSortNameAsc,
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
    filterAll: m.assignmentDetail_matrixFilterAll,
    filterStudents: m.assignmentDetail_matrixFilterStudents,
    roleFilterTooltip: m.matrix_roleFilterTooltip,
    viewAction: m.assignmentDetail_matrixView,
  }}
/>
