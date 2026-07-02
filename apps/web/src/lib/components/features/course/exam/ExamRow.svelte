<script lang="ts" module>
  function pillStatus(s: "running" | "upcoming" | "ended"): string {
    if (s === "running") return "in_progress";
    if (s === "upcoming") return "scheduled";
    return "ended";
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import AssessmentRow from "$lib/components/features/coursework/AssessmentRow.svelte";
  import type { examDomain } from "@nojv/application";

  interface Props {
    exam: examDomain.ExamAcrossRow;
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
  {delay}
>
  {#snippet timing()}
    {#if exam.status === "upcoming"}
      {m.examRow_ctaUpcoming()} <Countdown iso={exam.startsAt} isCompact />
    {:else if exam.status === "running"}
      {m.examRow_ctaRunning()} <Countdown iso={exam.endsAt} isCompact />
    {:else if exam.myStatus}
      {m.examRow_scoreLabel()}
      <span class="font-semibold text-foreground">{exam.myStatus.score}</span>
      / {exam.myStatus.totalPoints}
    {:else}
      {m.examRow_ctaEnded()}
      {new Date(exam.endsAt).getMonth() + 1}/{new Date(exam.endsAt).getDate()}
    {/if}
  {/snippet}
  {#snippet foot()}
    {m.examRow_durationLabel()}
    {m.examDetail_durationMinutes({ count: exam.durationMinutes })} · {m.examRow_scoringLabel()}
    {exam.scoringMode === "point_sum"
      ? m.examRow_scoringPointSum()
      : m.examRow_scoringProblemCount()}
  {/snippet}
</AssessmentRow>
