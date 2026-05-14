<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import TestcaseSetCard from "$lib/components/features/problem/testcase/TestcaseSetCard.svelte";
  import TestcaseZipUploader from "$lib/components/features/problem/testcase/TestcaseZipUploader.svelte";

  interface TestcaseData {
    id: string;
    ordinal: number;
    input: string;
    output: string | null;
  }

  interface TestcaseSetData {
    id: string;
    name: string;
    weight: number;
    scoringStrategy: string;
    testcases: TestcaseData[];
  }

  interface Props {
    testcaseSets: TestcaseSetData[];
    problemId: string;
  }

  let { testcaseSets, problemId }: Props = $props();

  let subtaskSets = $derived(testcaseSets.filter((s) => s.weight > 0));

  function strategyLabel(strategy: string): string {
    switch (strategy) {
      case "PROPORTIONAL":
        return m.testcases_scoringStrategyProportional();
      case "MINIMUM":
        return m.testcases_scoringStrategyMinimum();
      default:
        return m.testcases_scoringStrategyAllOrNothing();
    }
  }

  let error = $state<string | null>(null);
</script>

<div class="space-y-6">
  <section class="rounded-xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm">
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
        {#each subtaskSets as set (set.id)}
          <TestcaseSetCard {set} {problemId} />
        {/each}
      </div>

      <div class="mt-4 rounded-md bg-muted/50 px-3 py-2">
        <span class="text-caption text-muted-foreground">{m.testcases_totalScoreLabel()}: </span>
        <span class="text-caption font-mono"
          >{subtaskSets
            .map((s) => `${s.name} (${String(s.weight)}pts, ${strategyLabel(s.scoringStrategy)})`)
            .join(" + ")}</span
        >
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
