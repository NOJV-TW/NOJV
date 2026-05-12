<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { ChevronDown, ChevronRight, Pencil, Trash2, Eye, EyeOff } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { postProblemAction } from "$lib/utils/actions";
  import HelpTooltip from "$lib/components/ui/HelpTooltip.svelte";

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
      scoringStrategy: string;
      testcases: TestcaseData[];
    };
    problemId: string;
  }

  let { set, problemId }: Props = $props();

  const SCORING_STRATEGIES = ["ALL_OR_NOTHING", "PROPORTIONAL", "MINIMUM"] as const;
  type ScoringStrategy = (typeof SCORING_STRATEGIES)[number];

  async function changeScoringStrategy(value: string) {
    if (!SCORING_STRATEGIES.includes(value as ScoringStrategy)) return;
    saving = true;
    try {
      await postProblemAction(problemId, "updateTestcaseSetScoring", {
        setId: set.id,
        strategy: value
      });
      await invalidateAll();
    } finally {
      saving = false;
    }
  }

  let expanded = $state(false);
  let editing = $state(false);
  let confirmDelete = $state(false);
  let editingTestcaseId = $state<string | null>(null);
  let confirmDeleteTestcaseId = $state<string | null>(null);
  let saving = $state(false);

  // Edit state for set
  let editName = $state(untrack(() => set.name));
  let editWeight = $state(untrack(() => set.weight));

  // Edit state for testcase
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
        data: JSON.stringify({ name: editName, weight: editWeight })
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
        data: JSON.stringify({ input: editInput, output: editOutput })
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

<div class="rounded-lg border border-border-subtle p-2 transition-[box-shadow] duration-fast ease-out-soft hover:shadow-rest">
  <!-- Header -->
  <div class="flex items-center gap-3">
    <button
      class="flex items-center gap-1 text-body-sm font-semibold"
      onclick={() => (expanded = !expanded)}
      type="button"
    >
      {#if expanded}
        <ChevronDown class="size-4" />
      {:else}
        <ChevronRight class="size-4" />
      {/if}
      {set.name}
    </button>

    <span
      class="rounded-full bg-info/15 px-2.5 py-0.5 text-caption font-medium text-info tabular-nums"
    >
      {m.testcases_casesCount({ count: set.testcases.length })}
    </span>

    <span class="text-caption text-muted-foreground tabular-nums">
      {set.weight} {m.admin_pts()}
    </span>

    <label class="flex items-center gap-1 text-caption text-muted-foreground">
      <span>{m.testcases_scoringStrategy()}</span>
      <HelpTooltip text={m.testcases_scoringStrategyHint()} />
      <select
        class="ml-1 rounded-md border border-border bg-[color:var(--color-panel)] px-2 py-1 text-caption"
        value={set.scoringStrategy}
        disabled={saving}
        onchange={(e) => void changeScoringStrategy((e.target as HTMLSelectElement).value)}
      >
        <option value="ALL_OR_NOTHING">{m.testcases_scoringStrategyAllOrNothing()}</option>
        <option value="PROPORTIONAL">{m.testcases_scoringStrategyProportional()}</option>
        <option value="MINIMUM">{m.testcases_scoringStrategyMinimum()}</option>
      </select>
    </label>

    <div class="ml-auto flex items-center gap-2">
      <button
        class="rounded-full border border-border p-1.5 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
        onclick={startEditSet}
        type="button"
        title={m.testcases_editSet()}
      >
        <Pencil class="size-3.5" />
      </button>
      <button
        class="rounded-full border border-border p-1.5 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:bg-destructive/10 hover:text-destructive"
        onclick={() => (confirmDelete = true)}
        type="button"
        title={m.testcases_deleteSet()}
      >
        <Trash2 class="size-3.5" />
      </button>
    </div>
  </div>

  <!-- Inline edit for set -->
  {#if editing}
    <div class="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border-subtle bg-[color:var(--color-panel)] p-3">
      <label class="grid gap-1">
        <span class="text-caption font-medium text-muted-foreground">{m.testcases_editSetName()}</span>
        <input
          class="rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 text-body-sm"
          bind:value={editName}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-caption font-medium text-muted-foreground">{m.testcases_editSetWeight()}</span>
        <input
          class="w-20 rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 text-body-sm tabular-nums"
          type="number"
          min="0"
          bind:value={editWeight}
        />
      </label>
      <div class="flex gap-2">
        <button
          class="rounded-full bg-primary px-4 py-2 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
          onclick={saveSet}
          disabled={saving}
          type="button"
        >
          {saving ? m.admin_saving() : m.common_save()}
        </button>
        <button
          class="rounded-full border border-border px-4 py-2 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
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
    <div class="mt-3 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
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

  <!-- Expanded testcases -->
  {#if expanded}
    <div class="mt-3 space-y-2">
      {#each set.testcases as tc (tc.id)}
        <div class="rounded-md border border-border-subtle p-3">
          {#if editingTestcaseId === tc.id}
            <!-- Editing testcase -->
            <div class="space-y-2">
              <label class="grid gap-1 text-caption text-muted-foreground">
                {m.testcases_input()}
                <textarea
                  class="w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 font-mono text-caption"
                  rows={3}
                  bind:value={editInput}
                ></textarea>
              </label>
              <label class="grid gap-1 text-caption text-muted-foreground">
                {m.testcases_output()}
                <textarea
                  class="w-full rounded-md border border-border bg-[color:var(--color-panel)] px-3 py-2 font-mono text-caption"
                  rows={3}
                  bind:value={editOutput}
                ></textarea>
              </label>
              <div class="flex gap-2">
                <button
                  class="rounded-full bg-primary px-4 py-1.5 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
                  onclick={() => saveTestcase(tc.id)}
                  disabled={saving}
                  type="button"
                >
                  {saving ? m.admin_saving() : m.common_save()}
                </button>
                <button
                  class="rounded-full border border-border px-4 py-1.5 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
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
              <span class="text-body-sm text-destructive">
                {m.testcases_confirmDeleteCase({ ordinal: tc.ordinal })}
              </span>
              <button
                class="rounded-full bg-destructive px-4 py-1.5 text-caption font-semibold text-white transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 disabled:opacity-70"
                onclick={() => deleteTestcase(tc.id)}
                disabled={saving}
                type="button"
              >
                {saving ? m.testcases_deleting() : m.testcases_confirm()}
              </button>
              <button
                class="rounded-full border border-border px-4 py-1.5 text-caption font-semibold transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5"
                onclick={() => (confirmDeleteTestcaseId = null)}
                type="button"
              >
                {m.common_cancel()}
              </button>
            </div>
          {:else}
            <!-- View testcase -->
            <div class="flex items-start gap-3">
              <span class="shrink-0 text-caption font-medium text-muted-foreground tabular-nums">
                #{tc.ordinal}
              </span>
              <div class="min-w-0 flex-1 grid gap-1">
                <div class="text-caption text-muted-foreground">
                  <span class="font-medium">{m.testcases_input()}:</span>
                  <code class="ml-1 break-all">{truncate(tc.input)}</code>
                </div>
                <div class="text-caption text-muted-foreground">
                  <span class="font-medium">{m.testcases_output()}:</span>
                  <code class="ml-1 break-all">{truncate(tc.output ?? "")}</code>
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <button
                  class="rounded-full border border-border p-1 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
                  onclick={() => startEditTestcase(tc)}
                  type="button"
                  title={m.testcases_editTestcase()}
                >
                  <Pencil class="size-3" />
                </button>
                <button
                  class="rounded-full border border-border p-1 text-muted-foreground transition-[transform,box-shadow,background-color,color] duration-fast ease-out-soft hover:bg-destructive/10 hover:text-destructive"
                  onclick={() => (confirmDeleteTestcaseId = tc.id)}
                  type="button"
                  title={m.testcases_deleteTestcase()}
                >
                  <Trash2 class="size-3" />
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}

      {#if set.testcases.length === 0}
        <p class="text-body-sm text-muted-foreground">{m.testcases_noTestcasesInSet()}</p>
      {/if}
    </div>
  {/if}
</div>
