<script lang="ts" module>
  export type CourseworkKind = "assignment" | "exam" | "contest";

  type Def = { label: () => string; cls: string; style?: string };
</script>

<script lang="ts">
  import { cn } from "$lib/utils.js";
  import { m } from "$lib/paraglide/messages.js";

  const ASSIGNMENT: Record<string, Def> = {
    not_started: { label: () => m.statusPill_assignment_notStarted(), cls: "bg-muted text-muted-foreground" },
    in_progress: {
      label: () => m.statusPill_assignment_inProgress(),
      cls: "border",
      style:
        "background: color-mix(in oklab, var(--primary) 12%, transparent); color: var(--primary); border-color: color-mix(in oklab, var(--primary) 28%, transparent);"
    },
    submitted: { label: () => m.statusPill_assignment_submitted(), cls: "verdict-pending" },
    graded: { label: () => m.statusPill_assignment_graded(), cls: "verdict-ac" }
  };

  const EXAM: Record<string, Def> = {
    scheduled: { label: () => m.statusPill_exam_scheduled(), cls: "bg-muted text-muted-foreground" },
    open: {
      label: () => m.statusPill_exam_open(),
      cls: "",
      style: "background: color-mix(in oklab, var(--primary) 14%, transparent); color: var(--primary);"
    },
    in_progress: {
      label: () => m.statusPill_exam_inProgress(),
      cls: "",
      style:
        "background: color-mix(in oklab, var(--destructive) 14%, transparent); color: oklch(0.55 0.2 27);"
    },
    submitted: { label: () => m.statusPill_exam_submitted(), cls: "verdict-pending" },
    graded: { label: () => m.statusPill_exam_graded(), cls: "verdict-ac" }
  };

  const CONTEST: Record<string, Def> = {
    upcoming: { label: () => m.statusPill_contest_upcoming(), cls: "bg-muted text-muted-foreground" },
    live: {
      // "LIVE" is a brand/format word — keep as-is, not translated.
      label: () => "LIVE",
      cls: "",
      style:
        "background: color-mix(in oklab, var(--destructive) 14%, transparent); color: oklch(0.55 0.2 27);"
    },
    ended: { label: () => m.statusPill_contest_ended(), cls: "bg-muted text-muted-foreground" }
  };

  const MAPS: Record<CourseworkKind, Record<string, Def>> = {
    assignment: ASSIGNMENT,
    exam: EXAM,
    contest: CONTEST
  };

  interface Props {
    status: string;
    type?: CourseworkKind;
    class?: string;
  }

  let { status, type = "assignment", class: className }: Props = $props();

  const def = $derived<Def>(
    MAPS[type][status] ?? { label: () => status, cls: "bg-muted text-muted-foreground" }
  );
</script>

<span
  class={cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-mono uppercase tracking-wider",
    def.cls,
    className
  )}
  style={def.style}
>
  {#if status === "live"}
    <span class="size-1.5 rounded-full live-dot"></span>
  {/if}
  {def.label()}
</span>
