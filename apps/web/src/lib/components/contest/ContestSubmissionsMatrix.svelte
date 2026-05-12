<script lang="ts" module>
  import type { contestDomain } from "@nojv/domain";

  export type ContestSubmissionsMatrixData = contestDomain.ContestSubmissionsMatrix;
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import SubmissionsMatrixView from "../course/shared/SubmissionsMatrixView.svelte";

  interface Props {
    matrix: ContestSubmissionsMatrixData;
    contestId: string;
    class?: string;
  }

  let { matrix, contestId, class: className }: Props = $props();
</script>

<SubmissionsMatrixView
  {matrix}
  csvDownloadName={`contest-${contestId}-matrix.csv`}
  dataSlot="contest-submissions-matrix"
  class={className}
  labels={{
    heading: m.examDetail_submissionsHeading,
    hint: m.examDetail_submissionsHint,
    meta: m.examDetail_submissionsMeta,
    student: m.examDetail_submissionsStudent,
    total: m.examDetail_submissionsTotal,
    maxPoints: m.examDetail_submissionsMaxPoints,
    attempts: m.examDetail_submissionsAttempts,
    searchPlaceholder: m.examDetail_submissionsSearchPlaceholder,
    sortTotalDesc: m.examDetail_submissionsSortTotalDesc,
    sortHandleAsc: m.examDetail_submissionsSortHandleAsc,
    sortNameAsc: m.examDetail_submissionsSortNameAsc,
    exportCsv: m.examDetail_submissionsExportCsv,
    empty: m.examDetail_submissionsEmpty,
    legendAc: m.examDetail_submissionsLegendAc,
    legendPartial: m.examDetail_submissionsLegendPartial,
    legendZero: m.examDetail_submissionsLegendZero,
    legendEmpty: m.examDetail_submissionsLegendEmpty,
    paginationLabel: m.examDetail_submissionsPaginationLabel,
    prev: m.examDetail_submissionsPrev,
    next: m.examDetail_submissionsNext
  }}
/>
