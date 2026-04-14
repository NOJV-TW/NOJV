<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { getLocale } from "$lib/paraglide/runtime.js";
  import { assessmentPath } from "$lib/types";
  import { ClipboardList, LogIn } from "@lucide/svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { Badge } from "$lib/components/ui/badge";

  interface AssessmentItem {
    courseId: string;
    courseTitle: string;
    /** Soft deadline; null = no late penalty configured. */
    dueAt: string | null;
    opensAt: string;
    slug: string;
    title: string;
    windowState: string;
    windowStateColor: string;
  }

  interface Props {
    items: AssessmentItem[] | null;
  }

  let { items }: Props = $props();
  let currentLocale = $derived(getLocale());

  const labels = $derived({
    heading: m.assignmentsList_heading(),
    signInRequired: m.assignmentsList_signInRequired(),
    empty: m.assignmentsList_empty(),
    opens: m.assignmentsList_opens(),
    due: m.assignmentsList_due()
  });
</script>

<div class="space-y-6">
  <h2 class="font-display text-title-lg">
    {labels.heading}
  </h2>

  {#if items === null}
    <EmptyState
      icon={LogIn}
      title={labels.signInRequired}
    />
  {:else if items.length === 0}
    <EmptyState
      icon={ClipboardList}
      title={labels.empty}
    />
  {:else}
    <section class="grid gap-4">
      {#each items as a (`${a.courseId}-${a.slug}`)}
        <a
          class="rounded-2xl border border-border bg-[color:var(--color-panel)] backdrop-blur-sm grid gap-4 px-5 py-5 sm:grid-cols-[1.4fr_0.6fr_0.6fr_0.4fr] sm:items-center shadow-rest transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:shadow-hover motion-safe:hover:-translate-y-0.5"
          href={assessmentPath(a.courseId, a.slug)}
        >
          <div>
            <p class="text-body-sm text-muted-foreground">{a.courseTitle}</p>
            <h3 class="mt-1 text-title-sm font-semibold">{a.title}</h3>
          </div>
          <div>
            <p class="text-body-sm text-muted-foreground">{labels.opens}</p>
            <p class="mt-1 text-body-sm tabular-nums">
              {new Date(a.opensAt).toLocaleDateString(currentLocale)}
            </p>
          </div>
          <div>
            <p class="text-body-sm text-muted-foreground">{labels.due}</p>
            <p class="mt-1 text-body-sm tabular-nums">
              {a.dueAt ? new Date(a.dueAt).toLocaleDateString(currentLocale) : "—"}
            </p>
          </div>
          <div class="sm:text-right">
            <Badge variant="muted" class={a.windowStateColor}>
              {a.windowState}
            </Badge>
          </div>
        </a>
      {/each}
    </section>
  {/if}
</div>
