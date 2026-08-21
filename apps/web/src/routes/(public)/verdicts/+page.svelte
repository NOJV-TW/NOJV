<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { verdictTone } from "$lib/utils/verdict-style";

  const verdicts = [
    ["AC", () => m.verdicts_ac()],
    ["WA", () => m.verdicts_wa()],
    ["TLE", () => m.verdicts_tle()],
    ["MLE", () => m.verdicts_mle()],
    ["RE", () => m.verdicts_re()],
    ["CE", () => m.verdicts_ce()],
    ["SE", () => m.verdicts_se()],
  ] as const;
</script>

<svelte:head>
  <title>{m.verdicts_title()} · NOJV</title>
  <meta name="description" content={m.verdicts_description()} />
</svelte:head>

<PageContainer width="form" class="space-y-6">
  <header class="space-y-2">
    <h1 class="text-title-xl font-bold">{m.verdicts_title()}</h1>
    <p class="text-body-sm text-muted-foreground">{m.verdicts_description()}</p>
  </header>

  <Card variant="surface" size="lg" class="overflow-hidden p-0">
    <table class="w-full text-body-sm">
      <thead class="border-b border-border-subtle bg-muted/30 text-left text-caption">
        <tr>
          <th class="w-24 px-4 py-3 font-medium">{m.verdicts_code()}</th>
          <th class="px-4 py-3 font-medium">{m.verdicts_meaning()}</th>
        </tr>
      </thead>
      <tbody>
        {#each verdicts as [code, description] (code)}
          <tr class="border-b border-border-subtle last:border-0">
            <th
              class="px-4 py-3 text-left font-mono text-body font-semibold {verdictTone(code)}"
            >
              {code}
            </th>
            <td class="px-4 py-3 text-muted-foreground">{description()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </Card>
</PageContainer>
