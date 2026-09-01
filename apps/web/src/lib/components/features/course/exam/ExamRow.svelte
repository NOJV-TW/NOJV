<script lang="ts" module>
  export interface ExamRowData {
    id: string;
    title: string;
    courseTitle: string;
    status: "draft" | "upcoming" | "running" | "ended";
    startsAt: string | null;
    endsAt: string | null;
    durationMinutes: number | null;
    scoringMode: "problem_count" | "weighted_count" | "point_sum";
    totalPoints?: number;
    myStatus: { score: number; totalPoints: number } | null;
  }

  function pillStatus(s: ExamRowData["status"]): string {
    if (s === "running") return "in_progress";
    if (s === "upcoming") return "scheduled";
    if (s === "draft") return "draft";
    return "ended";
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";

  interface Props {
    exam: ExamRowData;
    showStatusIcon?: boolean;
    delay?: number;
  }

  let { exam, showStatusIcon = true, delay = 0 }: Props = $props();
</script>

<AssessmentRow
  href={`/exams/${exam.id}`}
  kind="exam"
  typeLabel={m.examDetail_typeLabel()}
  context={exam.courseTitle}
  title={exam.title}
  status={pillStatus(exam.status)}
  startsAt={exam.startsAt}
  endsAt={exam.endsAt}
  {showStatusIcon}
  {delay}
>
  {#snippet timing()}
    {#if exam.status === "upcoming" && exam.startsAt}
      <Countdown iso={exam.startsAt} isCompact />
    {:else if exam.status === "running" && exam.endsAt}
      <Countdown iso={exam.endsAt} isCompact />
    {/if}
  {/snippet}
  {#snippet foot()}
    {#if exam.myStatus}
      {exam.myStatus.score} / {exam.myStatus.totalPoints}
    {:else if exam.totalPoints != null}
      — / {exam.totalPoints}
    {:else}
      —
    {/if}
  {/snippet}
</AssessmentRow>
