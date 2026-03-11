<script lang="ts">
  import { t } from "svelte-i18n";
  import ProblemCreationPanel from "$lib/components/problem/CreationPanel.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {$t("problemDetail.editProblem")}: {data.problem.title}
  </h2>
  <ProblemCreationPanel mode="edit" initialData={data.problem} />
</div>
