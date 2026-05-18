<script lang="ts">
  import type { Action } from "svelte/action";
  import type { courseDomain } from "@nojv/domain";
  import Send from "@lucide/svelte/icons/send";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    isDraft: boolean;
    isUpcoming: boolean;
    submitting: boolean;
    enhance: Action<HTMLFormElement>;
    auditLog: courseDomain.AssessmentAuditEntry[];
  }

  let { isDraft, isUpcoming, submitting, enhance, auditLog }: Props = $props();

  let confirmingDelete = $state(false);

  function actionLabel(action: courseDomain.AssessmentAuditEntry["action"]): string {
    if (action === "publish") return m.assignmentDetail_lifecycleActionPublish();
    if (action === "revert_to_draft") return m.assignmentDetail_lifecycleActionRevert();
    return m.assignmentDetail_lifecycleActionDelete();
  }
</script>

<section
  class="rounded-xl border border-border bg-[color:var(--color-panel)] p-4 shadow-rest"
>
  <h3 class="mb-4 text-title-sm font-medium">
    {m.assignmentDetail_settingsSectionLifecycle()}
  </h3>

  <div class="flex flex-wrap items-center gap-3">
    {#if isDraft}
      <form method="POST" action="?/publishAssignment" use:enhance class="contents">
        <Button type="submit" size="sm" variant="default" disabled={submitting}>
          <Send class="mr-1 size-4" aria-hidden="true" />
          {m.assignmentDetail_settingsPublishButton()}
        </Button>
      </form>
    {/if}

    {#if isUpcoming}
      <form method="POST" action="?/revertToDraft" use:enhance class="contents">
        <Button type="submit" size="sm" variant="outline" disabled={submitting}>
          <Undo2 class="mr-1 size-4" aria-hidden="true" />
          {m.assignmentDetail_settingsRevertToDraftButton()}
        </Button>
      </form>
    {/if}
  </div>

  {#if auditLog.length > 0}
    <div class="mt-4 border-t border-border pt-4">
      <h4 class="mb-2 text-caption font-medium text-muted-foreground">
        {m.assignmentDetail_lifecycleHistoryHeading()}
      </h4>
      <ul class="space-y-1.5">
        {#each auditLog as entry, i (i)}
          <li class="flex items-baseline justify-between gap-3 text-caption">
            <span>
              {actionLabel(entry.action)}
              {#if entry.actorName}
                <span class="text-muted-foreground">· {entry.actorName}</span>
              {/if}
            </span>
            <span class="font-mono tabular-nums text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<!-- Danger zone (delete, drafts only) -->
{#if isDraft}
  <section
    class="space-y-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] px-6 py-5"
  >
    <div class="flex items-baseline gap-2">
      <AlertTriangle class="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <h4 class="text-body-lg font-medium text-destructive">
        {m.assignmentDetail_settingsDangerZone()}
      </h4>
    </div>

    {#if !confirmingDelete}
      <div class="flex items-center justify-between gap-4">
        <p class="text-caption text-muted-foreground">
          {m.assignmentDetail_settingsDeleteConfirmBody()}
        </p>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          onclick={() => (confirmingDelete = true)}
        >
          <Trash2 class="mr-1 size-4" aria-hidden="true" />
          {m.assignmentDetail_settingsDeleteButton()}
        </Button>
      </div>
    {:else}
      <div
        class="rounded-md border border-destructive/40 bg-destructive/[0.06] px-4 py-3"
      >
        <div class="font-semibold text-destructive">
          {m.assignmentDetail_settingsDeleteConfirmTitle()}
        </div>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.assignmentDetail_settingsDeleteConfirmBody()}
        </p>
        <div class="mt-3 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onclick={() => (confirmingDelete = false)}
            disabled={submitting}
          >
            {m.assignmentDetail_settingsDeleteConfirmCancel()}
          </Button>
          <form method="POST" action="?/deleteAssignment" use:enhance class="contents">
            <Button type="submit" variant="destructive" size="sm" disabled={submitting}>
              {m.assignmentDetail_settingsDeleteConfirmConfirm()}
            </Button>
          </form>
        </div>
      </div>
    {/if}
  </section>
{/if}
