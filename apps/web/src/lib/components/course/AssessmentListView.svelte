<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";

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
  let currentLocale = $derived(getLocale());

  const labels = $derived(
    type === "assignment"
      ? {
          heading: m.assignmentsList_heading(),
          signInRequired: m.assignmentsList_signInRequired(),
          empty: m.assignmentsList_empty(),
          opens: m.assignmentsList_opens(),
          due: m.assignmentsList_due()
        }
      : {
          heading: m.examsList_heading(),
          signInRequired: m.examsList_signInRequired(),
          empty: m.examsList_empty(),
          opens: m.examsList_opens(),
          due: m.examsList_due()
        }
  );
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">
    {labels.heading}
  </h2>

  {#if items === null}
    <p class="text-sm text-[color:var(--color-muted)]">
      {labels.signInRequired}
    </p>
  {:else if items.length === 0}
    <p class="text-sm text-[color:var(--color-muted)]">{labels.empty}</p>
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
            <p class="text-sm text-[color:var(--color-muted)]">{labels.opens}</p>
            <p class="mt-1 text-sm">{new Date(a.opensAt).toLocaleDateString(currentLocale)}</p>
          </div>
          <div>
            <p class="text-sm text-[color:var(--color-muted)]">{labels.due}</p>
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
