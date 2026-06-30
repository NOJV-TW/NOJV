<script lang="ts">
  import { Code2, History } from "@lucide/svelte";
  import { submissionResultVerdicts } from "@nojv/core";
  import { m } from "$lib/paraglide/messages.js";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
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

  const RESULT_VERDICTS: readonly string[] = submissionResultVerdicts;
  let verdictOptions = $derived([
    ...RESULT_VERDICTS,
    ...[...new Set(data.submissions.map((s) => s.status))]
      .filter((status) => !RESULT_VERDICTS.includes(status))
      .sort(),
  ]);
  let languageOptions = $derived([...new Set(data.submissions.map((s) => s.language))].sort());

  let filtered = $derived(
    data.submissions.filter((sub) => {
      if (verdictFilter && sub.status !== verdictFilter) return false;
      if (languageFilter && sub.language !== languageFilter) return false;
      if (
        titleQuery &&
        !sub.problemTitle.toLowerCase().includes(titleQuery.trim().toLowerCase())
      )
        return false;
      return true;
    }),
  );
</script>

<PageContainer>
  <div class="space-y-6 fade-up">
    <PageHeader
      eyebrow={m.submissionsTop_eyebrow()}
      title={m.navigation_submissions()}
      description={m.submissions_workspaceHint()}
    >
      {#snippet icon()}
        <History class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
      {/snippet}
    </PageHeader>

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
            variant: "default",
          },
        ]}
      />
    {:else}
      <div class="glass mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
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
              class="glass hover-lift rounded-xl px-5 py-4 no-underline shadow-rest"
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
              <div
                class="mt-1 flex flex-wrap items-center gap-3 text-caption text-muted-foreground"
              >
                <VerdictBadge verdict={sub.status} />
                <Badge variant="outline" size="xs">{contextLabel(sub.context)}</Badge>
                <span>{sub.language}</span>
                <span class="tabular-nums">{sub.score}/{sub.totalScore}</span>
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
  </div>
</PageContainer>
