<script lang="ts">
  import AdvancedModeWorkspace from "$lib/components/problem/advanced/AdvancedModeWorkspace.svelte";
  import ProblemWorkspace from "$lib/components/problem/Workspace.svelte";

  let { data } = $props();
</script>

<div
  class="flex h-[calc(100vh-7rem)] overflow-hidden rounded-[2rem] border border-border"
>
  {#if data.problem.type === "special_env"}
    <AdvancedModeWorkspace
      allowedLanguages={data.allowedLanguages}
      assessment={data.assessmentProp}
      backLink={data.backLink}
      contestSlug={data.contestSlug}
      initialSubmissions={data.submissions}
      problem={data.problem}
      testcaseSets={data.testcaseSets}
    />
  {:else}
    <ProblemWorkspace
      allowedLanguages={data.allowedLanguages}
      assessment={data.assessmentProp}
      backLink={data.backLink}
      contestSlug={data.contestSlug}
      initialSubmissions={data.submissions}
      problem={data.problem}
      testcaseSets={data.testcaseSets}
    />
  {/if}
</div>
