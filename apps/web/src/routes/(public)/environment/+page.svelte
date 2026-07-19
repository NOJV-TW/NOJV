<script lang="ts">
  import { judgeEnvironment } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";

  const languages = Object.values(judgeEnvironment.languages);
</script>

<svelte:head>
  <title>{m.environment_title()} · NOJV</title>
  <meta name="description" content={m.environment_metaDescription()} />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-8">
  <section class="space-y-3">
    <h1 class="text-title-xl font-bold text-foreground">{m.environment_title()}</h1>
    <p class="max-w-3xl text-body-lg text-muted-foreground">
      {m.environment_description()}
    </p>
  </section>

  <div class="border-y border-border-subtle py-4">
    <dl class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <dt class="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        {m.environment_platformLabel()}
      </dt>
      <dd class="text-body font-semibold text-foreground">
        {judgeEnvironment.platform.name}
        {judgeEnvironment.platform.version}
      </dd>
    </dl>
  </div>

  <Card variant="surface" size="lg" class="min-w-0 overflow-hidden p-0">
    <div class="min-w-0 max-w-full overflow-x-auto">
      <table class="w-full min-w-4xl text-left text-body-sm">
        <thead
          class="border-b border-border-subtle bg-muted/40 text-caption text-muted-foreground"
        >
          <tr>
            <th scope="col" class="px-5 py-3 font-semibold">{m.environment_languageColumn()}</th
            >
            <th scope="col" class="px-5 py-3 font-semibold">{m.environment_versionColumn()}</th>
            <th scope="col" class="px-5 py-3 font-semibold">{m.environment_compileColumn()}</th>
            <th scope="col" class="px-5 py-3 font-semibold">{m.environment_runColumn()}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          {#each languages as language (language.label)}
            <tr>
              <th scope="row" class="px-5 py-4 font-semibold text-foreground">
                {language.label}
              </th>
              <td class="px-5 py-4 whitespace-nowrap text-muted-foreground"
                >{language.version}</td
              >
              <td class="px-5 py-4">
                {#if language.compileCommand}
                  <code class="whitespace-nowrap font-mono text-caption text-foreground">
                    {language.compileCommand}
                  </code>
                {:else}
                  <span class="text-muted-foreground">{m.environment_noCompilation()}</span>
                {/if}
              </td>
              <td class="px-5 py-4">
                <code class="whitespace-nowrap font-mono text-caption text-foreground">
                  {language.runCommand}
                </code>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>
</div>
