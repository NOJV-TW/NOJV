<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";

  export type SettingsTabDetail = courseDomain.AssignmentDetail;
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils.js";

  interface Props {
    detail: SettingsTabDetail;
    class?: string;
  }

  let { detail, class: className }: Props = $props();

  /** Strip timezone so <input type="datetime-local"> can prefill. */
  function toDateTimeLocal(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }
</script>

<section data-slot="assignment-settings-tab" class={cn("space-y-6", className)}>
  <div class="flex items-baseline justify-between gap-4">
    <div>
      <h2 class="font-display text-title font-medium leading-tight">
        {m.assignmentDetail_settingsHeading()}
      </h2>
      <p class="mt-1 text-caption text-muted-foreground">
        {m.assignmentDetail_settingsHint()}
      </p>
    </div>
  </div>

  <!-- Read-only placeholder form. Wiring to a server action lands in
       Phase 4 (task 4.2). Keeping the markup faithful to prototype 07
       so when the action is ready we only need to swap in `use:enhance`
       and bind the superform. -->
  <form class="space-y-5" onsubmit={(e) => e.preventDefault()}>
    <div class="space-y-1.5">
      <label for="asg-title" class="block text-caption font-semibold text-muted-foreground">
        {m.assignmentDetail_settingsTitleLabel()}
      </label>
      <input
        id="asg-title"
        type="text"
        value={detail.title}
        readonly
        class="h-10 w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body text-foreground"
      />
    </div>

    <div class="grid grid-cols-1 gap-5 md:grid-cols-3">
      <div class="space-y-1.5">
        <label for="asg-opens" class="block text-caption font-semibold text-muted-foreground">
          {m.assignmentDetail_settingsOpensLabel()}
        </label>
        <input
          id="asg-opens"
          type="datetime-local"
          value={toDateTimeLocal(detail.opensAt)}
          readonly
          class="h-10 w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body text-foreground"
        />
      </div>
      <div class="space-y-1.5">
        <label for="asg-due" class="block text-caption font-semibold text-muted-foreground">
          {m.assignmentDetail_settingsDueLabel()}
        </label>
        <input
          id="asg-due"
          type="datetime-local"
          value={toDateTimeLocal(detail.dueAt)}
          readonly
          class="h-10 w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body text-foreground"
        />
      </div>
      <div class="space-y-1.5">
        <label for="asg-closes" class="block text-caption font-semibold text-muted-foreground">
          {m.assignmentDetail_settingsClosesLabel()}
        </label>
        <input
          id="asg-closes"
          type="datetime-local"
          value={toDateTimeLocal(detail.closesAt)}
          readonly
          class="h-10 w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body text-foreground"
        />
      </div>
    </div>

    <div class="space-y-1.5">
      <div class="block text-caption font-semibold text-muted-foreground">
        {m.assignmentDetail_settingsProblemsLabel()}
      </div>
      <p class="text-caption text-muted-foreground">
        {m.assignmentDetail_settingsProblemsHint()}
      </p>
      <div class="flex flex-wrap gap-2 pt-1">
        {#each detail.problems as problem (problem.problemId)}
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-caption font-semibold text-muted-foreground"
          >
            <span class="font-display text-foreground">{problem.letter}</span>
            {problem.title}
          </span>
        {/each}
      </div>
    </div>

    <p class="rounded-md border border-border bg-muted/40 px-4 py-3 text-caption text-muted-foreground">
      {m.assignmentDetail_settingsNotYetWired()}
    </p>

    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" type="button" disabled>
        {m.assignmentDetail_settingsCancel()}
      </Button>
      <Button variant="default" size="sm" type="submit" disabled>
        {m.assignmentDetail_settingsSave()}
      </Button>
    </div>
  </form>

  <!-- Danger zone -->
  <div
    class="space-y-3 rounded-lg border border-destructive/30 bg-destructive/[0.04] px-6 py-5"
  >
    <div>
      <h4 class="font-display text-body-lg font-medium text-destructive">
        {m.assignmentDetail_dangerHeading()}
      </h4>
      <p class="mt-1 text-caption text-muted-foreground">{m.assignmentDetail_dangerHint()}</p>
    </div>

    <div class="flex items-center justify-between border-t border-destructive/20 pt-3">
      <div>
        <div class="font-medium">{m.assignmentDetail_dangerCopyTitle()}</div>
        <div class="mt-1 text-caption text-muted-foreground">
          {m.assignmentDetail_dangerCopyDesc()}
        </div>
      </div>
      <Button variant="outline" size="sm" disabled>
        {m.assignmentDetail_dangerCopyButton()}
      </Button>
    </div>

    <div class="flex items-center justify-between border-t border-destructive/20 pt-3">
      <div>
        <div class="font-medium">{m.assignmentDetail_dangerUnpublishTitle()}</div>
        <div class="mt-1 text-caption text-muted-foreground">
          {m.assignmentDetail_dangerUnpublishDesc()}
        </div>
      </div>
      <Button variant="outline" size="sm" disabled>
        {m.assignmentDetail_dangerUnpublishButton()}
      </Button>
    </div>

    <div class="flex items-center justify-between border-t border-destructive/20 pt-3">
      <div>
        <div class="font-medium">{m.assignmentDetail_dangerDeleteTitle()}</div>
        <div class="mt-1 text-caption text-muted-foreground">
          {m.assignmentDetail_dangerDeleteDesc()}
        </div>
      </div>
      <Button variant="destructive" size="sm" disabled>
        {m.assignmentDetail_dangerDeleteButton()}
      </Button>
    </div>

    <p class="pt-2 text-caption text-muted-foreground">
      {m.assignmentDetail_dangerNotWired()}
    </p>
  </div>
</section>
