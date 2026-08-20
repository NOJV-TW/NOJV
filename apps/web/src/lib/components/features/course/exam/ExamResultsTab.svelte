<script lang="ts" module>
  export interface ResultsProblemCol {
    id: string;
    letter: string;
    title: string;
    max: number;
  }

  export interface ResultsRow {
    rank: number;
    user: string;
    sid: string;
    total: number;
    scores: number[];
    me: boolean;
  }

  export interface ResultsBucket {
    label: string;
    count: number;
  }

  export interface ExamResultsTabData {
    problems: ResultsProblemCol[];
    rows: ResultsRow[];
    classAvg: number;
    median: number;
    max: number;
    min: number;
    submitted: number;
    total: number;
    maxScore: number;
    buckets: ResultsBucket[];
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import AssessmentGradesTab from "$lib/components/features/coursework/AssessmentGradesTab.svelte";
  import type { examDomain } from "@nojv/application";

  interface Props {
    data: ExamResultsTabData;
    matrix: examDomain.ExamSubmissionsMatrix;
    examId: string;
    oncellclick?: ((userId: string, problemId: string) => void) | undefined;
  }

  let { data, matrix, examId, oncellclick }: Props = $props();
</script>

<AssessmentGradesTab
  {matrix}
  stats={data}
  csvDownloadName={`exam-${examId}-grades.csv`}
  dataSlot="exam-grade-matrix"
  {oncellclick}
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
    gradeCellTitle: m.matrix_gradeCellTitle,
  }}
/>
