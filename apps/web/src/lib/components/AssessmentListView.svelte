<script lang="ts">
  import { locale, t } from "svelte-i18n";
  import { DEFAULT_LOCALE } from "$lib/i18n";

  interface AssessmentItem {
    courseSlug: string;
    courseTitle: string;
    dueAt: string;
    opensAt: string;
    slug: string;
    title: string;
    windowState: string;
    windowStateColor: string;
  }

  interface Props {
    items: AssessmentItem[] | null;
    type: "assignment" | "exam";
  }

  let { items, type }: Props = $props();
  let currentLocale = $derived($locale ?? DEFAULT_LOCALE);
  let i18nPrefix = $derived(type === "assignment" ? "assignmentsList" : "examsList");
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {$t(`${i18nPrefix}.heading`)}
  </h2>

  {#if items === null}
    <p class="text-sm text-[color:var(--color-muted)]">
      {$t(`${i18nPrefix}.signInRequired`)}
    </p>
  {:else if items.length === 0}
    <p class="text-sm text-[color:var(--color-muted)]">{$t(`${i18nPrefix}.empty`)}</p>
  {:else}
    <section class="grid gap-4">
      {#each items as a (`${a.courseSlug}-${a.slug}`)}
        <a
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center transition hover:-translate-y-0.5"
          href="/courses/{a.courseSlug}/{type === 'assignment' ? 'assignments' : 'exams'}/{a.slug}"
        >
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{a.courseTitle}</p>
            <h3 class="mt-1 text-xl font-semibold">{a.title}</h3>
          </div>
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{$t(`${i18nPrefix}.opens`)}</p>
            <p class="mt-1 text-sm">{new Date(a.opensAt).toLocaleDateString(currentLocale)}</p>
          </div>
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{$t(`${i18nPrefix}.due`)}</p>
            <p class="mt-1 text-sm">{new Date(a.dueAt).toLocaleDateString(currentLocale)}</p>
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
