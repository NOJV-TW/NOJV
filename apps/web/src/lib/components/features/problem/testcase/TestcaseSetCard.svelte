<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { ChevronDown, ChevronRight, Pencil, Trash2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { postProblemAction } from "$lib/utils/actions";
  import TestcaseRow from "./TestcaseRow.svelte";
  import TestcaseSetEditForm from "./TestcaseSetEditForm.svelte";

  interface TestcaseData {
    id: string;
    ordinal: number;
    input: string;
    output: string | null;
  }

  interface Props {
    set: {
      id: string;
      name: string;
      weight: number;
      testcases: TestcaseData[];
    };
    problemId: string;
  }

  let { set, problemId }: Props = $props();

  let expanded = $state(false);
  let editing = $state(false);
  let confirmDelete = $state(false);
  let editingTestcaseId = $state<string | null>(null);
  let confirmDeleteTestcaseId = $state<string | null>(null);
  let saving = $state(false);

  let editName = $state(untrack(() => set.name));
  let editWeight = $state(untrack(() => set.weight));

  let editInput = $state("");
  let editOutput = $state("");

  function startEditSet() {
    editName = set.name;
    editWeight = set.weight;
    editing = true;
  }

  async function saveSet() {
    saving = true;
    try {
      await postProblemAction(problemId, "updateTestcaseSet", {
        setId: set.id,
        data: JSON.stringify({ name: editName, weight: editWeight }),
      });
      editing = false;
      await invalidateAll();
    } finally {
      saving = false;
    }
  }

  async function deleteSet() {
    saving = true;
    try {
      await postProblemAction(problemId, "deleteTestcaseSet", { setId: set.id });
      confirmDelete = false;
      await invalidateAll();
    } finally {
      saving = false;
    }
  }

  function startEditTestcase(tc: TestcaseData) {
    editInput = tc.input;
    editOutput = tc.output ?? "";
    editingTestcaseId = tc.id;
  }

  async function saveTestcase(tcId: string) {
    saving = true;
    try {
      await postProblemAction(problemId, "updateTestcase", {
        testcaseId: tcId,
        data: JSON.stringify({ input: editInput, output: editOutput }),
      });
      editingTestcaseId = null;
      await invalidateAll();
    } finally {
      saving = false;
    }
  }

  async function deleteTestcase(tcId: string) {
    saving = true;
    try {
      await postProblemAction(problemId, "deleteTestcase", { testcaseId: tcId });
      confirmDeleteTestcaseId = null;
      await invalidateAll();
    } finally {
      saving = false;
    }
  }
</script>

<div
  class="rounded-lg border border-border-subtle-subtle p-2 transition-[box-shadow] duration-fast ease-out-soft hover:shadow-rest"
>
  <div class="flex items-center gap-3">
    <button
      class="flex items-center gap-1 text-body-sm font-semibold"
      onclick={() => (expanded = !expanded)}
      type="button"
    >
      {#if expanded}
        <ChevronDown aria-hidden="true" class="size-4" />
      {:else}
        <ChevronRight aria-hidden="true" class="size-4" />
      {/if}
      {set.name}
    </button>

    <span
      class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info tabular-nums"
    >
      {m.testcases_casesCount({ count: set.testcases.length })}
    </span>

    <span class="text-caption text-muted-foreground tabular-nums">
      {set.weight}
      {m.admin_pts()}
    </span>

    <div class="ml-auto flex items-center gap-2">
      <button
        class="rounded-full border border-border p-1.5 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
        onclick={startEditSet}
        type="button"
        title={m.testcases_editSet()}
      >
        <Pencil aria-hidden="true" class="size-3.5" />
      </button>
      <button
        class="rounded-full border border-border p-1.5 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:bg-destructive/10 hover:text-destructive"
        onclick={() => (confirmDelete = true)}
        type="button"
        title={m.testcases_deleteSet()}
      >
        <Trash2 aria-hidden="true" class="size-3.5" />
      </button>
    </div>
  </div>

  {#if editing}
    <TestcaseSetEditForm
      {editName}
      {editWeight}
      {saving}
      onSave={() => void saveSet()}
      onCancel={() => (editing = false)}
      onNameChange={(v) => (editName = v)}
      onWeightChange={(v) => (editWeight = v)}
    />
  {/if}

  {#if confirmDelete}
    <div
      class="mt-3 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3"
    >
      <span class="text-body-sm text-destructive">
        {m.testcases_confirmDeleteSet({ name: set.name })}
      </span>
      <button
        class="rounded-full bg-destructive px-4 py-1.5 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
        onclick={deleteSet}
        disabled={saving}
        type="button"
      >
        {saving ? m.testcases_deleting() : m.testcases_confirm()}
      </button>
      <button
        class="rounded-full border border-border px-4 py-1.5 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
        onclick={() => (confirmDelete = false)}
        type="button"
      >
        {m.common_cancel()}
      </button>
    </div>
  {/if}

  {#if expanded}
    <div class="mt-3 space-y-2">
      {#each set.testcases as tc (tc.id)}
        <TestcaseRow
          {tc}
          editing={editingTestcaseId === tc.id}
          confirmingDelete={confirmDeleteTestcaseId === tc.id}
          {saving}
          {editInput}
          {editOutput}
          onStartEdit={() => startEditTestcase(tc)}
          onSaveEdit={() => void saveTestcase(tc.id)}
          onCancelEdit={() => (editingTestcaseId = null)}
          onStartDelete={() => (confirmDeleteTestcaseId = tc.id)}
          onConfirmDelete={() => void deleteTestcase(tc.id)}
          onCancelDelete={() => (confirmDeleteTestcaseId = null)}
          onInputChange={(v) => (editInput = v)}
          onOutputChange={(v) => (editOutput = v)}
        />
      {/each}

      {#if set.testcases.length === 0}
        <p class="text-body-sm text-muted-foreground">{m.testcases_noTestcasesInSet()}</p>
      {/if}
    </div>
  {/if}
</div>
