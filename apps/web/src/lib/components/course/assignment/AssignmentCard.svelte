<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";

  export type AssignmentRow = courseDomain.AssignmentsTopRow;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import StatusPill from "$lib/components/coursework/StatusPill.svelte";
  import ProgressRing from "$lib/components/coursework/ProgressRing.svelte";
  import Countdown from "$lib/components/coursework/Countdown.svelte";
  import TypeIcon from "$lib/components/coursework/TypeIcon.svelte";
  import { diffMs, fmtCountdown } from "$lib/utils/datetime";

  interface Props {
    assignment: AssignmentRow;
    delay?: number;
  }

  let { assignment, delay = 0 }: Props = $props();

  // Drive urgency from a live clock so the "截止將至" hint updates without a reload.
  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => clearInterval(id);
  });

  // Map domain status (draft|upcoming|open|closed) onto the design's
  // student-facing vocabulary (not_started|in_progress|submitted|graded)
  // so the shared StatusPill renders correctly.
  function pillStatus(status: AssignmentRow["status"], allSolved: boolean): string {
    switch (status) {
      case "upcoming":
        return "not_started";
      case "open":
        return "in_progress";
      case "closed":
        return allSolved ? "graded" : "submitted";
      case "draft":
      default:
        return "not_started";
    }
  }

  const solved = $derived(assignment.myStatus?.solved ?? 0);
  const total = $derived(assignment.myStatus?.total ?? assignment.problemCount);
  const pct = $derived(total > 0 ? Math.round((solved / total) * 100) : 0);
  const allSolved = $derived(total > 0 && solved >= total);
  const status = $derived(pillStatus(assignment.status, allSolved));

  const countdown = $derived(
    assignment.closesAt ? fmtCountdown(diffMs(assignment.closesAt, new Date(now))) : null
  );
  const urgent = $derived(
    !!countdown && !countdown.past && countdown.d < 2 && assignment.status === "open"
  );

  // Manager rows have classStats instead of myStatus.
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

  <div class="mt-3 flex items-start gap-4">
    <div class="flex-1 min-w-0">
      <h3 class="text-title font-semibold leading-tight">
        {assignment.title}
      </h3>
      <div
        class="mt-1.5 flex items-center gap-2 text-caption text-muted-foreground"
      >
        {#if assignment.closesAt && countdown}
          {#if countdown.past}
            <span class="font-mono">{m.countdown_past()}</span>
          {:else}
            <span class="font-mono">{m.assignmentCard_countdownPrefix()}</span>
            <Countdown iso={assignment.closesAt} compact />
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
    <ProgressRing value={pct} size={48} stroke={5} />
  </div>

  <div class="mt-5 pt-4 border-t flex items-center justify-between" style="border-color: var(--border-subtle);">
    <StatusPill {status} type="assignment" />
    <div class="text-right">
      <div class="text-micro font-mono uppercase tracking-wider text-muted-foreground">
        {isManagerRow ? m.assignmentCard_submittedLabel() : m.assignmentCard_progressLabel()}
      </div>
      <div class="mt-0.5 font-mono">
        {#if isManagerRow && assignment.classStats}
          <span class="text-body font-semibold">{assignment.classStats.submittedUsers}</span>
          <span class="text-muted-foreground"> / {assignment.classStats.totalStudents}</span>
        {:else}
          <span class="text-body font-semibold">{solved}</span>
          <span class="text-muted-foreground"> / {total}</span>
        {/if}
      </div>
    </div>
  </div>
</a>
