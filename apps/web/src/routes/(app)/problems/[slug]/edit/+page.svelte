<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ProblemTabs from "$lib/components/problem/ProblemTabs.svelte";

  let { data } = $props();

  let activeTab = $state("basic");
</script>

<div class="mx-auto max-w-4xl space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {m.problemDetail_editProblem()}: {data.problem.title}
  </h2>

  <section class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-6 py-6 backdrop-blur-sm">
    <ProblemTabs bind:activeTab>
      {#snippet basic()}
        <p class="text-sm text-muted-foreground">
          基本資訊設定 (BasicInfoTab — Task 8)
        </p>
      {/snippet}

      {#snippet submission()}
        <p class="text-sm text-muted-foreground">
          提交設定 (SubmissionTab — Task 9)
        </p>
      {/snippet}

      {#snippet testcase()}
        <p class="text-sm text-muted-foreground">
          測資管理 (TestcaseTab — Task 10)
        </p>
      {/snippet}

      {#snippet judge()}
        <p class="text-sm text-muted-foreground">
          判題設定 (JudgeTab — Task 11)
        </p>
      {/snippet}

      {#snippet scoring()}
        <p class="text-sm text-muted-foreground">
          評分規則 (ScoringTab — Task 12)
        </p>
      {/snippet}
    </ProblemTabs>
  </section>
</div>
