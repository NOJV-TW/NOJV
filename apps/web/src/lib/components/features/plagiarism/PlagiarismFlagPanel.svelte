<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    lastRunLabel: string;
    showFlagged: boolean;
    showToggle: boolean;
    flaggedHiddenCount: number;
    onShowFlaggedChange: (next: boolean) => void;
  }

  let {
    lastRunLabel,
    showFlagged,
    showToggle,
    flaggedHiddenCount,
    onShowFlaggedChange
  }: Props = $props();
</script>

<div class="flex flex-wrap items-baseline justify-between gap-4">
  <div>
    <h2 class="text-title font-medium leading-tight">
      {m.assignmentDetail_plagHeading()}
    </h2>
    {#if lastRunLabel !== ""}
      <p class="mt-1 text-caption text-muted-foreground">
        {m.assignmentDetail_plagLastRun({ when: lastRunLabel })}
      </p>
    {/if}
  </div>
  {#if showToggle}
    <label class="flex cursor-pointer items-center gap-2 text-body-sm text-muted-foreground">
      <input
        type="checkbox"
        class="h-4 w-4 accent-primary"
        checked={showFlagged}
        onchange={(e) => onShowFlaggedChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span>
        {m.plagiarism_showFlagged()}
        {#if flaggedHiddenCount > 0 && !showFlagged}
          <span class="ml-1 text-muted-foreground">({flaggedHiddenCount})</span>
        {/if}
      </span>
    </label>
  {/if}
</div>
