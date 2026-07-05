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
    delay?: number;
  }

  let { exam, delay = 0 }: Props = $props();
</script>

<AssessmentRow
  href={`/exams/${exam.id}`}
  kind="exam"
  typeLabel={m.examDetail_typeLabel()}
  context={exam.courseTitle}
  title={exam.title}
  status={pillStatus(exam.status)}
  dateIso={exam.startsAt}
  {delay}
>
  {#snippet timing()}
    {#if exam.status === "upcoming" && exam.startsAt}
      {m.examRow_ctaUpcoming()} <Countdown iso={exam.startsAt} isCompact />
    {:else if exam.status === "running" && exam.endsAt}
      {m.examRow_ctaRunning()} <Countdown iso={exam.endsAt} isCompact />
    {:else if exam.status === "ended"}
      {#if exam.myStatus}
        {m.examRow_scoreLabel()}
        <span class="font-semibold text-foreground">{exam.myStatus.score}</span>
        / {exam.myStatus.totalPoints}
      {:else if exam.endsAt}
        {m.examRow_ctaEnded()}
        {new Date(exam.endsAt).getMonth() + 1}/{new Date(exam.endsAt).getDate()}
      {/if}
    {/if}
  {/snippet}
  {#snippet foot()}
    {#if exam.durationMinutes != null}
      {m.examRow_durationLabel()}
      {m.examDetail_durationMinutes({ count: exam.durationMinutes })} ·
    {/if}
    {m.examRow_scoringLabel()}
    {exam.scoringMode === "point_sum"
      ? m.examRow_scoringPointSum()
      : m.examRow_scoringProblemCount()}
  {/snippet}
</AssessmentRow>
