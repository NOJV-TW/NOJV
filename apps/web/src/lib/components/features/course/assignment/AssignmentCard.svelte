<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";

  export type AssignmentRow = courseDomain.AssignmentsTopRow;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import StatusPill from "$lib/components/features/coursework/StatusPill.svelte";
  import Countdown from "$lib/components/primitives/visual/Countdown.svelte";
  import TypeIcon from "$lib/components/features/coursework/TypeIcon.svelte";
  import { diffMs, fmtCountdown } from "$lib/utils/datetime";

  interface Props {
    assignment: AssignmentRow;
    delay?: number;
  }

  let { assignment, delay = 0 }: Props = $props();

  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => clearInterval(id);
  });

  function pillStatus(status: AssignmentRow["status"]): string {
    switch (status) {
      case "upcoming":
        return "not_started";
      case "open":
        return "in_progress";
      case "closed":
        return "closed";
      case "draft":
      default:
        return "not_started";
    }
  }

  const solved = $derived(assignment.myStatus?.solved ?? 0);
  const total = $derived(assignment.myStatus?.total ?? assignment.problemCount);
  const score = $derived(assignment.myStatus?.score ?? 0);
  const totalPoints = $derived(assignment.myStatus?.totalPoints ?? 0);
  const status = $derived(pillStatus(assignment.status));
  const showScore = $derived(
    assignment.classStats === null &&
      assignment.status !== "upcoming" &&
      assignment.status !== "draft",
  );

  const countdown = $derived(
    assignment.closesAt ? fmtCountdown(diffMs(assignment.closesAt, new Date(now))) : null,
  );
  const urgent = $derived(
    !!countdown && !countdown.past && countdown.d < 2 && assignment.status === "open",
  );

  const isManagerRow = $derived(assignment.classStats !== null);
</script>

<a
  href={`/assignments/${assignment.id}`}
  class="group glass hover-lift rounded-xl p-4 shadow-rest fade-up block no-underline text-foreground"
  style="animation-delay: {String(delay)}ms; {urgent
    ? 'border-color: color-mix(in oklab, var(--primary) 35%, transparent);'
    : ''}"
>
  <div
    class="flex items-center gap-2 text-micro font-mono uppercase tracking-[0.18em] text-muted-foreground"
  >
    <TypeIcon kind="assignment" size={12} />
    <span class="truncate">{assignment.courseTitle}</span>
    {#if isManagerRow}
      <span
        class="ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium"
        style="background: color-mix(in oklab, var(--info) 12%, transparent); color: var(--info);"
      >
        {m.assignmentCard_managerBadge()}
      </span>
    {/if}
  </div>

  <div class="mt-3">
    <h3 class="text-title font-semibold leading-tight">
      {assignment.title}
    </h3>
    <div class="mt-1.5 flex items-center gap-2 text-caption text-muted-foreground">
      {#if assignment.closesAt && countdown}
        {#if countdown.past}
          <span class="font-mono">{m.countdown_past()}</span>
        {:else}
          <span class="font-mono">{m.assignmentCard_countdownPrefix()}</span>
          <Countdown iso={assignment.closesAt} isCompact />
          {#if urgent}
            <span
              class="text-micro font-mono uppercase tracking-wider"
              style="color: var(--primary);"
            >
              · {m.assignmentCard_dueSoon()}
            </span>
          {/if}
        {/if}
      {:else}
        <span class="font-mono">{m.assignmentCard_unscheduled()}</span>
      {/if}
    </div>
  </div>

  <div
    class="mt-5 pt-4 border-t flex items-center justify-between"
    style="border-color: var(--border-subtle);"
  >
    <StatusPill {status} type="assignment" />
    <div class="text-right">
      <div class="text-micro font-mono uppercase tracking-wider text-muted-foreground">
        {#if isManagerRow}
          {m.assignmentCard_submittedLabel()}
        {:else if showScore}
          {m.assignmentCard_scoreLabel()}
        {:else}
          {m.assignmentCard_progressLabel()}
        {/if}
      </div>
      <div class="mt-0.5 font-mono">
        {#if isManagerRow && assignment.classStats}
          <span class="text-body font-semibold">{assignment.classStats.submittedUsers}</span>
          <span class="text-muted-foreground"> / {assignment.classStats.totalStudents}</span>
        {:else if showScore}
          <span class="text-body font-semibold">{score}</span>
          <span class="text-muted-foreground"> / {totalPoints}</span>
        {:else}
          <span class="text-body font-semibold">{solved}</span>
          <span class="text-muted-foreground"> / {total}</span>
        {/if}
      </div>
    </div>
  </div>
</a>
