<script lang="ts">
  import { t } from "svelte-i18n";
  import ProblemCreationPanel from "$lib/components/problem/CreationPanel.svelte";
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {$t("problems.createNew")}
  </h2>
  <ProblemCreationPanel />
</div>
