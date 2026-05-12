<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { m } from "$lib/paraglide/messages.js";
  import ScoreOverrideForm, {
    type OverrideRow,
    type ProblemOption,
    type StudentOption
  } from "./ScoreOverrideForm.svelte";
  import ScoreOverrideList, {
    type OverrideListRow
  } from "./ScoreOverrideList.svelte";

  interface Props {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    contextType: "assignment" | "exam" | "contest";
    contextId: string;
    students: StudentOption[];
    problems: ProblemOption[];
  }

  let { open, onOpenChange, contextType, contextId, students, problems }: Props = $props();

  let rows = $state<OverrideListRow[]>([]);
  let loading = $state(false);
  let editTarget = $state<OverrideRow | null>(null);

  async function reload() {
    loading = true;
    try {
      const url = new URL("/api/overrides", window.location.origin);
      // Query carries the discriminated context flat:
      // `type=<assignment|exam|contest>&(assignmentId|examId|contestId)=...`.
      url.searchParams.set("type", contextType);
      const idKey = `${contextType}Id` as const;
      url.searchParams.set(idKey, contextId);
      const res = await fetch(url.toString());
      if (res.ok) {
        const body = (await res.json()) as { items: OverrideListRow[] };
        rows = body.items;
      } else {
        rows = [];
      }
    } catch {
      rows = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      void reload();
    } else {
      editTarget = null;
    }
  });

  function handleOpenChange(v: boolean) {
    onOpenChange(v);
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content
    showCloseButton
    class="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
  >
    <Dialog.Header>
      <Dialog.Title>{m.override_staff_buttonLabel()}</Dialog.Title>
      <Dialog.Description>
        {m.override_staff_reasonHint()}
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-6">
      <section class="space-y-3">
        <h3 class="text-title-sm font-medium">
          {m.override_staff_buttonLabel()}
        </h3>
        {#if loading}
          <div class="text-caption text-muted-foreground">
            {m.override_staff_emptyList()}
          </div>
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

      <section class="space-y-3 border-t border-border pt-5">
        <div class="flex items-center justify-between">
          <h3 class="text-title-sm font-medium">
            {editTarget
              ? m.override_staff_editBtn()
              : m.override_staff_newBtn()}
          </h3>
          {#if editTarget}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={() => (editTarget = null)}
            >
              {m.rejudge_dialog_cancelBtn()}
            </Button>
          {/if}
        </div>
        {#key editTarget?.id ?? "__new__"}
          <ScoreOverrideForm
            mode={editTarget ? "edit" : "create"}
            {contextType}
            {contextId}
            {students}
            {problems}
            existing={editTarget}
            onsuccess={() => {
              editTarget = null;
              void reload();
            }}
            oncancel={editTarget ? () => (editTarget = null) : undefined}
          />
        {/key}
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>
