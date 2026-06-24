<script lang="ts">
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { Button } from "$lib/components/primitives/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import ScoreOverrideForm, {
    type OverrideRow,
    type ProblemOption,
    type StudentOption,
  } from "./ScoreOverrideForm.svelte";
  import ScoreOverrideList, { type OverrideListRow } from "./ScoreOverrideList.svelte";
  import FeedbackForm, { type FeedbackRow } from "./FeedbackForm.svelte";
  import FeedbackList, { type FeedbackListRow } from "./FeedbackList.svelte";
  import { SkeletonTable } from "$lib/components/primitives/ui/skeleton";

  interface Props {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    contextType: "assignment" | "exam" | "contest";
    contextId: string;
    students: StudentOption[];
    problems: ProblemOption[];
    prefill?: { userId: string; problemId: string } | null | undefined;
  }

  let {
    open,
    onOpenChange,
    contextType,
    contextId,
    students,
    problems,
    prefill = null,
  }: Props = $props();

  const showFeedback = $derived(contextType !== "contest");
  const prefillKey = $derived(prefill ? `${prefill.userId}:${prefill.problemId}` : "__new__");

  let rows = $state<OverrideListRow[]>([]);
  let loading = $state(false);
  let loadError = $state(false);
  let editTarget = $state<OverrideRow | null>(null);

  let feedbackRows = $state<FeedbackListRow[]>([]);
  let feedbackLoading = $state(false);
  let feedbackError = $state(false);
  let feedbackEditTarget = $state<FeedbackRow | null>(null);

  async function reload() {
    loading = true;
    loadError = false;
    try {
      const url = new URL("/api/overrides", window.location.origin);
      url.searchParams.set("type", contextType);
      const idKey = `${contextType}Id` as const;
      url.searchParams.set(idKey, contextId);
      const res = await fetch(url.toString());
      if (res.ok) {
        const body = (await res.json()) as { items: OverrideListRow[] };
        rows = body.items;
      } else {
        loadError = true;
      }
    } catch {
      loadError = true;
    } finally {
      loading = false;
    }
  }

  async function reloadFeedback() {
    if (!showFeedback) return;
    feedbackLoading = true;
    feedbackError = false;
    try {
      const url = new URL("/api/feedback", window.location.origin);
      url.searchParams.set("type", contextType);
      const idKey = `${contextType}Id` as const;
      url.searchParams.set(idKey, contextId);
      const res = await fetch(url.toString());
      if (res.ok) {
        const body = (await res.json()) as { items: FeedbackListRow[] };
        feedbackRows = body.items;
      } else {
        feedbackError = true;
      }
    } catch {
      feedbackError = true;
    } finally {
      feedbackLoading = false;
    }
  }

  $effect(() => {
    if (open) {
      void reload();
      void reloadFeedback();
    } else {
      editTarget = null;
      feedbackEditTarget = null;
    }
  });

  function handleOpenChange(v: boolean) {
    onOpenChange(v);
  }
</script>

{#snippet loadErrorBlock(retry: () => void)}
  <div
    class="flex flex-col items-center gap-2 rounded-md border border-border px-3 py-6 text-center"
  >
    <p class="text-body-sm text-muted-foreground">{m.grading_drawer_loadError()}</p>
    <Button variant="outline" size="sm" type="button" onclick={retry}>
      {m.common_retry()}
    </Button>
  </div>
{/snippet}

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content showCloseButton class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{m.grading_drawer_title()}</Dialog.Title>
      <Dialog.Description>
        {m.grading_drawer_description()}
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-6">
      <section class="space-y-3">
        <h3 class="text-title-sm font-medium">
          {m.override_staff_buttonLabel()}
        </h3>
        {#if loading}
          <div
            aria-busy="true"
            aria-live="polite"
            class="overflow-hidden rounded-md border border-border"
          >
            <SkeletonTable rows={3} columns={6} class="px-3" />
          </div>
        {:else if loadError}
          {@render loadErrorBlock(() => void reload())}
        {:else}
          <ScoreOverrideList
            {rows}
            {students}
            {problems}
            onedit={(r) => (editTarget = r)}
            ondelete={() => void reload()}
          />
        {/if}
      </section>

      <section class="space-y-3 border-t border-border-subtle pt-5">
        <div class="flex items-center justify-between">
          <h3 class="text-title-sm font-medium">
            {editTarget ? m.override_staff_editBtn() : m.override_staff_newBtn()}
          </h3>
          {#if editTarget}
            <Button variant="ghost" size="sm" type="button" onclick={() => (editTarget = null)}>
              {m.rejudge_dialog_cancelBtn()}
            </Button>
          {/if}
        </div>
        {#key editTarget?.id ?? prefillKey}
          <ScoreOverrideForm
            mode={editTarget ? "edit" : "create"}
            {contextType}
            {contextId}
            {students}
            {problems}
            existing={editTarget}
            initialUserId={editTarget ? undefined : (prefill?.userId ?? undefined)}
            initialProblemId={editTarget ? undefined : (prefill?.problemId ?? undefined)}
            onsuccess={() => {
              editTarget = null;
              void reload();
            }}
            oncancel={editTarget ? () => (editTarget = null) : undefined}
          />
        {/key}
      </section>

      {#if showFeedback}
        {@const feedbackContextType = contextType as "assignment" | "exam"}
        <section class="space-y-3 border-t border-border-subtle pt-5">
          <h3 class="text-title-sm font-medium">
            {m.feedback_staff_sectionTitle()}
          </h3>
          {#if feedbackLoading}
            <div
              aria-busy="true"
              aria-live="polite"
              class="overflow-hidden rounded-md border border-border"
            >
              <SkeletonTable rows={3} columns={5} class="px-3" />
            </div>
          {:else if feedbackError}
            {@render loadErrorBlock(() => void reloadFeedback())}
          {:else}
            <FeedbackList
              rows={feedbackRows}
              {students}
              {problems}
              onedit={(r) => (feedbackEditTarget = r)}
              ondelete={() => void reloadFeedback()}
            />
          {/if}

          <div class="flex items-center justify-between pt-2">
            <h4 class="text-body-sm font-medium">
              {feedbackEditTarget ? m.feedback_staff_editBtn() : m.feedback_staff_newBtn()}
            </h4>
            {#if feedbackEditTarget}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onclick={() => (feedbackEditTarget = null)}
              >
                {m.rejudge_dialog_cancelBtn()}
              </Button>
            {/if}
          </div>
          {#key feedbackEditTarget?.id ?? "__new__"}
            <FeedbackForm
              mode={feedbackEditTarget ? "edit" : "create"}
              contextType={feedbackContextType}
              {contextId}
              {students}
              {problems}
              existing={feedbackEditTarget}
              onsuccess={() => {
                feedbackEditTarget = null;
                void reloadFeedback();
              }}
              oncancel={feedbackEditTarget ? () => (feedbackEditTarget = null) : undefined}
            />
          {/key}
        </section>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
