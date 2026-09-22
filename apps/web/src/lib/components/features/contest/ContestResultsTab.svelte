<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import AssessmentGradesTab from "$lib/components/features/coursework/AssessmentGradesTab.svelte";
  import type { contestDomain } from "@nojv/application";
  import type { ContestResults } from "$lib/server/results/contest";

  interface Props {
    data: ContestResults;
    matrix: contestDomain.ContestSubmissionsMatrix;
    contestId: string;
  }

  let { data, matrix, contestId }: Props = $props();
</script>

<AssessmentGradesTab
  {matrix}
  stats={data}
  csvDownloadName={`contest-${contestId}-grades.csv`}
  dataSlot="contest-grade-matrix"
  labels={{
    heading: m.examDetail_submissionsHeading,
    hint: m.examDetail_submissionsHint,
    meta: m.examDetail_submissionsMeta,
    student: m.examDetail_submissionsStudent,
    total: m.examDetail_submissionsTotal,
    maxPoints: m.examDetail_submissionsMaxPoints,
    attempts: m.examDetail_submissionsAttempts,
    searchPlaceholder: m.examDetail_submissionsSearchPlaceholder,
    exportCsv: m.examDetail_submissionsExportCsv,
    empty: m.examDetail_submissionsEmpty,
    legendAc: m.examDetail_submissionsLegendAc,
    legendPartial: m.examDetail_submissionsLegendPartial,
    legendZero: m.examDetail_submissionsLegendZero,
    legendEmpty: m.examDetail_submissionsLegendEmpty,
    paginationLabel: m.examDetail_submissionsPaginationLabel,
    prev: m.examDetail_submissionsPrev,
    next: m.examDetail_submissionsNext,
  }}
/>
