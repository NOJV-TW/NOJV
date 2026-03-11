<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";

  let { data } = $props();
  let locale = $derived(($page.params as { locale: string }).locale);
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {$t("assignmentsList.heading")}
  </h2>

  {#if data.items === null}
    <p class="text-sm text-[color:var(--color-muted)]">
      {$t("assignmentsList.signInRequired")}
    </p>
  {:else if data.items.length === 0}
    <p class="text-sm text-[color:var(--color-muted)]">{$t("assignmentsList.empty")}</p>
  {:else}
    <section class="grid gap-4">
      {#each data.items as a (`${a.courseSlug}-${a.slug}`)}
        <a
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center transition hover:-translate-y-0.5"
          href="/{locale}/courses/{a.courseSlug}/assignments/{a.slug}"
        >
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{a.courseTitle}</p>
            <h3 class="mt-1 text-xl font-semibold">{a.title}</h3>
          </div>
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{$t("assignmentsList.opens")}</p>
            <p class="mt-1 text-sm">{new Date(a.opensAt).toLocaleDateString(locale)}</p>
          </div>
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{$t("assignmentsList.due")}</p>
            <p class="mt-1 text-sm">{new Date(a.dueAt).toLocaleDateString(locale)}</p>
          </div>
          <div class="sm:text-right">
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium {a.windowStateColor}"
            >
              {a.windowState}
            </span>
          </div>
        </a>
      {/each}
    </section>
  {/if}
</div>
