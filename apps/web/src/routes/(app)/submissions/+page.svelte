<script lang="ts">
  import { Code2 } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";

  let { data } = $props();

  type SubmissionRow = (typeof data.submissions)[number];

  function formatMemory(kb: number): string {
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${String(kb)} KB`;
  }

  function contextLabel(kind: SubmissionRow["context"]): string {
    switch (kind) {
      case "assignment":
        return m.submissions_kind_assignment();
      case "contest":
        return m.submissions_kind_contest();
      case "exam":
        return m.submissions_kind_exam();
      default:
        return m.submissions_kind_practice();
    }
  }

  let verdictFilter = $state("");
  let languageFilter = $state("");
  let titleQuery = $state("");

  let verdictOptions = $derived([...new Set(data.submissions.map((s) => s.status))].sort());
  let languageOptions = $derived([...new Set(data.submissions.map((s) => s.language))].sort());

  let filtered = $derived(
    data.submissions.filter((sub) => {
      if (verdictFilter && sub.status !== verdictFilter) return false;
      if (languageFilter && sub.language !== languageFilter) return false;
      if (titleQuery && !sub.problemTitle.toLowerCase().includes(titleQuery.trim().toLowerCase()))
        return false;
      return true;
    })
  );
</script>

<Section>
  {#snippet header()}
    <h1 class="text-title-lg">{m.navigation_submissions()}</h1>
    <p>{m.submissions_workspaceHint()}</p>
  {/snippet}

  {#if data.submissions.length === 0}
    <EmptyState
      variant="onboarding"
      icon={Code2}
      title={m.submissions_empty()}
      description={m.submissions_emptyHint()}
      actions={[
        {
          href: "/problems",
          label: m.submissions_browseCta(),
          variant: "default"
        }
      ]}
    />
  {:else}
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-caption text-muted-foreground">
        <span>{m.submissions_filterVerdict()}</span>
        <select
          class="rounded-md border border-border bg-background px-2 py-1 text-body-sm"
          bind:value={verdictFilter}
        >
          <option value="">{m.submissions_filterAll()}</option>
          {#each verdictOptions as status (status)}
            <option value={status}>{formatVerdictLabel(status)}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center gap-2 text-caption text-muted-foreground">
        <span>{m.submissions_filterLanguage()}</span>
        <select
          class="rounded-md border border-border bg-background px-2 py-1 text-body-sm"
          bind:value={languageFilter}
        >
          <option value="">{m.submissions_filterAll()}</option>
          {#each languageOptions as lang (lang)}
            <option value={lang}>{lang}</option>
          {/each}
        </select>
      </label>
      <label class="flex flex-1 items-center gap-2 text-caption text-muted-foreground">
        <span>{m.submissions_filterProblem()}</span>
        <input
          class="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-body-sm"
          type="search"
          placeholder={m.submissions_filterProblem()}
          bind:value={titleQuery}
        />
      </label>
    </div>

    {#if filtered.length === 0}
      <p class="py-8 text-center text-body-sm text-muted-foreground">
        {m.submissions_noMatches()}
      </p>
    {:else}
      <div class="grid gap-2">
        {#each filtered as sub (sub.id)}
          <a
            class="rounded-md border border-border-subtle px-4 py-3 transition-[transform,box-shadow,background-color,border-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent hover:shadow-rest"
            href="/submissions/{sub.id}"
          >
            <div class="flex items-baseline justify-between gap-3">
              <span class="truncate text-body-sm font-semibold text-foreground">
                {sub.problemTitle}
              </span>
              <span class="shrink-0 text-caption text-muted-foreground tabular-nums">
                {formatDateTime(sub.createdAt)}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-3 text-caption text-muted-foreground">
              <VerdictBadge verdict={sub.status} />
              <Badge variant="outline" size="xs">{contextLabel(sub.context)}</Badge>
              <span>{sub.language}</span>
              <span class="tabular-nums">{sub.score}/100</span>
              {#if sub.runtimeMs && sub.runtimeMs > 0}
                <span class="tabular-nums">{sub.runtimeMs} ms</span>
              {/if}
              {#if sub.memoryKb && sub.memoryKb > 0}
                <span class="tabular-nums">{formatMemory(sub.memoryKb)}</span>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</Section>
