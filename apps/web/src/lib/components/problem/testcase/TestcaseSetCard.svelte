<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { ChevronDown, ChevronRight, Pencil, Trash2, Eye, EyeOff } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { postProblemAction } from "$lib/utils/actions";

  interface TestcaseData {
    id: string;
    ordinal: number;
    stdin: string;
    expectedStdout: string | null;
  }

  interface Props {
    set: {
      id: string;
      name: string;
      isHidden: boolean;
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

  // Edit state for set
  let editName = $state(untrack(() => set.name));
  let editWeight = $state(untrack(() => set.weight));
  let editIsHidden = $state(untrack(() => set.isHidden));

  // Edit state for testcase
  let editStdin = $state("");
  let editExpectedStdout = $state("");

  function startEditSet() {
    editName = set.name;
    editWeight = set.weight;
    editIsHidden = set.isHidden;
    editing = true;
  }

  async function saveSet() {
    saving = true;
    try {
      await postProblemAction(problemId, "updateTestcaseSet", {
        setId: set.id,
        data: JSON.stringify({ name: editName, weight: editWeight, isHidden: editIsHidden })
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
    editStdin = tc.stdin;
    editExpectedStdout = tc.expectedStdout ?? "";
    editingTestcaseId = tc.id;
  }

  async function saveTestcase(tcId: string) {
    saving = true;
    try {
      await postProblemAction(problemId, "updateTestcase", {
        testcaseId: tcId,
        data: JSON.stringify({ stdin: editStdin, expectedStdout: editExpectedStdout })
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

  function truncate(text: string, maxLen: number = 80): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  }
</script>

<div class="rounded-2xl border border-border p-4">
  <!-- Header -->
  <div class="flex items-center gap-3">
    <button
      class="flex items-center gap-1 text-sm font-semibold"
      onclick={() => (expanded = !expanded)}
      type="button"
    >
      {#if expanded}
        <ChevronDown class="h-4 w-4" />
      {:else}
        <ChevronRight class="h-4 w-4" />
      {/if}
      {set.name}
    </button>

    <span
      class="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400"
    >
      {m.testcases_casesCount({ count: set.testcases.length })}
    </span>

    <span class="text-xs text-muted-foreground">
      {set.weight} pts
    </span>

    {#if set.isHidden}
      <span class="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <EyeOff class="h-3 w-3" />
        {m.testcases_hidden()}
      </span>
    {:else}
      <span class="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <Eye class="h-3 w-3" />
        {m.testcases_visible()}
      </span>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      <button
        class="rounded-full border border-border p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        onclick={startEditSet}
        type="button"
        title="Edit set"
      >
        <Pencil class="h-3.5 w-3.5" />
      </button>
      <button
        class="rounded-full border border-border p-1.5 text-muted-foreground transition hover:bg-red-500/10 hover:text-red-600"
        onclick={() => (confirmDelete = true)}
        type="button"
        title="Delete set"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>

  <!-- Inline edit for set -->
  {#if editing}
    <div class="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-[color:var(--color-panel)] p-3">
      <label class="grid gap-1">
        <span class="text-xs font-medium text-muted-foreground">{m.testcases_editSetName()}</span>
        <input
          class="rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
          bind:value={editName}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs font-medium text-muted-foreground">{m.testcases_editSetWeight()}</span>
        <input
          class="w-20 rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 text-sm"
          type="number"
          min="0"
          bind:value={editWeight}
        />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="accent-primary"
          bind:checked={editIsHidden}
        />
        {m.testcases_hidden()}
      </label>
      <div class="flex gap-2">
        <button
          class="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-70"
          onclick={saveSet}
          disabled={saving}
          type="button"
        >
          {saving ? m.admin_saving() : m.common_save()}
        </button>
        <button
          class="rounded-full border border-border px-4 py-2 text-xs font-semibold transition hover:-translate-y-0.5"
          onclick={() => (editing = false)}
          type="button"
        >
          {m.common_cancel()}
        </button>
      </div>
    </div>
  {/if}

  <!-- Confirm delete -->
  {#if confirmDelete}
    <div class="mt-3 flex items-center gap-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-500/10 p-3">
      <span class="text-sm text-red-700 dark:text-red-400">
        {m.testcases_confirmDeleteSet({ name: set.name })}
      </span>
      <button
        class="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-70"
        onclick={deleteSet}
        disabled={saving}
        type="button"
      >
        {saving ? m.testcases_deleting() : m.testcases_confirm()}
      </button>
      <button
        class="rounded-full border border-border px-4 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5"
        onclick={() => (confirmDelete = false)}
        type="button"
      >
        {m.common_cancel()}
      </button>
    </div>
  {/if}

  <!-- Expanded testcases -->
  {#if expanded}
    <div class="mt-3 space-y-2">
      {#each set.testcases as tc (tc.id)}
        <div class="rounded-xl border border-border p-3">
          {#if editingTestcaseId === tc.id}
            <!-- Editing testcase -->
            <div class="space-y-2">
              <label class="grid gap-1 text-xs text-muted-foreground">
                stdin
                <textarea
                  class="w-full rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 font-mono text-xs"
                  rows={3}
                  bind:value={editStdin}
                ></textarea>
              </label>
              <label class="grid gap-1 text-xs text-muted-foreground">
                expected stdout
                <textarea
                  class="w-full rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-2 font-mono text-xs"
                  rows={3}
                  bind:value={editExpectedStdout}
                ></textarea>
              </label>
              <div class="flex gap-2">
                <button
                  class="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-70"
                  onclick={() => saveTestcase(tc.id)}
                  disabled={saving}
                  type="button"
                >
                  {saving ? m.admin_saving() : m.common_save()}
                </button>
                <button
                  class="rounded-full border border-border px-4 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5"
                  onclick={() => (editingTestcaseId = null)}
                  type="button"
                >
                  {m.common_cancel()}
                </button>
              </div>
            </div>
          {:else if confirmDeleteTestcaseId === tc.id}
            <!-- Confirm delete testcase -->
            <div class="flex items-center gap-3">
              <span class="text-sm text-red-700 dark:text-red-400">
                {m.testcases_confirmDeleteCase({ ordinal: tc.ordinal })}
              </span>
              <button
                class="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-70"
                onclick={() => deleteTestcase(tc.id)}
                disabled={saving}
                type="button"
              >
                {saving ? m.testcases_deleting() : m.testcases_confirm()}
              </button>
              <button
                class="rounded-full border border-border px-4 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5"
                onclick={() => (confirmDeleteTestcaseId = null)}
                type="button"
              >
                {m.common_cancel()}
              </button>
            </div>
          {:else}
            <!-- View testcase -->
            <div class="flex items-start gap-3">
              <span class="shrink-0 text-xs font-medium text-muted-foreground">
                #{tc.ordinal}
              </span>
              <div class="min-w-0 flex-1 grid gap-1">
                <div class="text-xs text-muted-foreground">
                  <span class="font-medium">stdin:</span>
                  <code class="ml-1 break-all">{truncate(tc.stdin)}</code>
                </div>
                <div class="text-xs text-muted-foreground">
                  <span class="font-medium">stdout:</span>
                  <code class="ml-1 break-all">{truncate(tc.expectedStdout ?? "")}</code>
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  class="rounded-full border border-border p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  onclick={() => startEditTestcase(tc)}
                  type="button"
                  title="Edit testcase"
                >
                  <Pencil class="h-3 w-3" />
                </button>
                <button
                  class="rounded-full border border-border p-1 text-muted-foreground transition hover:bg-red-500/10 hover:text-red-600"
                  onclick={() => (confirmDeleteTestcaseId = tc.id)}
                  type="button"
                  title="Delete testcase"
                >
                  <Trash2 class="h-3 w-3" />
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}

      {#if set.testcases.length === 0}
        <p class="text-sm text-muted-foreground">{m.testcases_noTestcasesInSet()}</p>
      {/if}
    </div>
  {/if}
</div>
