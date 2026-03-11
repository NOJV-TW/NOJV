<script lang="ts">
  import { t } from "svelte-i18n";
  import ProblemsTabs from "$lib/components/problem/Tabs.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">{$t("navigation.problems")}</h2>

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicProblems={data.publicProblems}
    showCreate={data.showCreate}
  />
</div>
