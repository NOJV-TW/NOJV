<script lang="ts" module>
  export type CourseworkKind = "assignment" | "exam" | "contest";

  type Def = { label: () => string; cls: string; style?: string };
</script>

<script lang="ts">
  import { cn } from "$lib/css.js";
  import { m } from "$lib/paraglide/messages.js";

  // Each status owns its own border-color so the pill outline stays visible
  // and consistent across all kinds, regardless of background contrast with
  // the page surface.
  const NEUTRAL_STYLE =
    "border-color: color-mix(in oklab, var(--foreground) 14%, transparent);";
  const PRIMARY_STYLE =
    "background: color-mix(in oklab, var(--primary) 14%, transparent); color: var(--primary); border-color: color-mix(in oklab, var(--primary) 32%, transparent);";
  const DESTRUCTIVE_STYLE =
    "background: color-mix(in oklab, var(--destructive) 14%, transparent); color: oklch(0.55 0.2 27); border-color: color-mix(in oklab, var(--destructive) 32%, transparent);";
  const SUCCESS_STYLE =
    "background: color-mix(in oklab, var(--success) 15%, transparent); color: oklch(0.45 0.13 160); border-color: color-mix(in oklab, var(--success) 32%, transparent);";
  const INFO_STYLE =
    "background: color-mix(in oklab, var(--info) 15%, transparent); color: oklch(0.45 0.12 230); border-color: color-mix(in oklab, var(--info) 32%, transparent);";

  const ASSIGNMENT: Record<string, Def> = {
    not_started: { label: () => m.statusPill_assignment_notStarted(), cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE },
    in_progress: { label: () => m.statusPill_assignment_inProgress(), cls: "", style: PRIMARY_STYLE },
    submitted: { label: () => m.statusPill_assignment_submitted(), cls: "", style: INFO_STYLE },
    closed: { label: () => m.statusPill_assignment_closed(), cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE }
  };

  const EXAM: Record<string, Def> = {
    scheduled: { label: () => m.statusPill_exam_scheduled(), cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE },
    open: { label: () => m.statusPill_exam_open(), cls: "", style: PRIMARY_STYLE },
    in_progress: { label: () => m.statusPill_exam_inProgress(), cls: "", style: DESTRUCTIVE_STYLE },
    submitted: { label: () => m.statusPill_exam_submitted(), cls: "", style: INFO_STYLE },
    ended: { label: () => m.statusPill_exam_ended(), cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE }
  };

  const CONTEST: Record<string, Def> = {
    upcoming: { label: () => m.statusPill_contest_upcoming(), cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE },
    // "LIVE" is a brand/format word — keep as-is, not translated.
    live: { label: () => "LIVE", cls: "", style: DESTRUCTIVE_STYLE },
    ended: { label: () => m.statusPill_contest_ended(), cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE }
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
    MAPS[type][status] ?? { label: () => status, cls: "bg-muted text-muted-foreground", style: NEUTRAL_STYLE }
  );
</script>

<span
  class={cn(
    "inline-flex min-w-20 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-mono uppercase tracking-wider",
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
