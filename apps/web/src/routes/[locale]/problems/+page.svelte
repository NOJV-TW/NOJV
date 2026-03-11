<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";
  import ProblemsTabs from "$lib/components/ProblemsTabs.svelte";

  let { data } = $props();
  let locale = $derived(($page.params as { locale: string }).locale);
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">{$t("navigation.problems")}</h2>

  <ProblemsTabs
    editableProblems={data.editableProblems}
    publicProblems={data.publicProblems}
    showCreate={data.showCreate}
    {locale}
  />
</div>
