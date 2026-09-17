<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import TestcaseSetCard from "$lib/components/features/problem/testcase/TestcaseSetCard.svelte";
  import TestcaseZipUploader from "$lib/components/features/problem/testcase/TestcaseZipUploader.svelte";
  import MarkdownRenderer from "$lib/components/primitives/layout/MarkdownRenderer.svelte";

  interface TestcaseData {
    id: string;
    ordinal: number;
    input: string;
    output: string | null;
  }

  interface TestcaseSetData {
    id: string;
    name: string;
    description: string;
    weight: number;
    testcases: TestcaseData[];
  }

  interface Props {
    testcaseSets: TestcaseSetData[];
    problemId: string;
  }

  let { testcaseSets, problemId }: Props = $props();

  let subtaskSets = $derived(testcaseSets.filter((s) => s.weight > 0));

  let error = $state<string | null>(null);
</script>

<div class="space-y-6">
  <section
    class="rounded-xl border border-border-subtle bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-4">
      <p class="text-body-sm font-bold">{m.testcases_hiddenCases()}</p>
      <p class="mt-1 text-caption text-muted-foreground">
        {m.testcases_hiddenCasesHint()}
      </p>
    </div>

    {#if subtaskSets.length === 0}
      <p class="text-body-sm text-muted-foreground">{m.testcases_noSubtaskSets()}</p>
    {:else}
      <div class="space-y-3">
        {#each subtaskSets as set, idx (set.id)}
          <TestcaseSetCard {set} {problemId} index={idx + 1} />
        {/each}
      </div>

      <div class="mt-4 rounded-md bg-muted/50 px-3 py-2">
        <span class="text-caption text-muted-foreground"
          >{m.testcases_totalScoreLabel()}:
        </span>
        {#each subtaskSets as set, idx (set.id)}
          {#if idx > 0}<span class="text-caption font-mono">&nbsp;+&nbsp;</span>{/if}
          <span class="text-caption font-mono">
            <MarkdownRenderer content={set.name} inline />
            ({set.weight}pts)
          </span>
        {/each}
      </div>
    {/if}
  </section>

  <TestcaseZipUploader {problemId} onError={(msg) => (error = msg)} />

  {#if error}
    <div
      class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
    >
      {error}
    </div>
  {/if}
</div>
