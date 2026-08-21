<script lang="ts">
  import { Code2, History } from "@lucide/svelte";
  import { languageLabel, languageSchema, submissionResultVerdicts } from "@nojv/core";
  import { goto, invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { watchSubmissionVerdict } from "$lib/stores/sse";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import * as Select from "$lib/components/primitives/ui/select";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel } from "$lib/utils/verdict-style";
  import VerdictBadge from "$lib/components/primitives/ui/VerdictBadge.svelte";

  let { data } = $props();

  type SubmissionRow = (typeof data.submissions)[number];

  let loaded = $state<SubmissionRow[]>([]);
  let moreCursor = $state<string | null>(null);
  let loadingMore = $state(false);

  const activeCursor = $derived(loaded.length === 0 ? data.nextCursor : moreCursor);

  const allRows = $derived.by(() => {
    const seen = new Set<string>();
    const rows: SubmissionRow[] = [];
    for (const row of [...data.submissions, ...loaded]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    return rows;
  });

  async function loadMore() {
    if (loadingMore || !activeCursor) return;
    loadingMore = true;
    try {
      const res = await fetch(`/api/submissions?cursor=${encodeURIComponent(activeCursor)}`);
      if (!res.ok) return;
      const page = (await res.json()) as {
        items: SubmissionRow[];
        nextCursor: string | null;
      };
      loaded = [...loaded, ...page.items];
      moreCursor = page.nextCursor;
    } finally {
      loadingMore = false;
    }
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

  function displayLanguage(value: string): string {
    const parsed = languageSchema.safeParse(value);
    return parsed.success ? languageLabel(parsed.data) : value;
  }

  let verdictFilter = $state("");
  let languageFilter = $state("");
  let problemFilter = $state("");
  let contextFilter = $state("");

  const RESULT_VERDICTS: readonly string[] = submissionResultVerdicts;
  let verdictOptions = $derived([
    ...RESULT_VERDICTS,
    ...[...new Set(allRows.map((s) => s.status))]
      .filter((status) => !RESULT_VERDICTS.includes(status))
      .sort(),
  ]);
  let languageOptions = $derived([...new Set(allRows.map((s) => s.language))].sort());
  let contextOptions = $derived([...new Set(allRows.map((s) => s.context))].sort());
  let problemOptions = $derived.by(() => {
    const unique = new Map(
      allRows.map((submission) => [submission.problemId, submission.problemTitle]),
    );
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  let filtered = $derived(
    allRows.filter((sub) => {
      if (verdictFilter && sub.status !== verdictFilter) return false;
      if (languageFilter && sub.language !== languageFilter) return false;
      if (problemFilter && sub.problemId !== problemFilter) return false;
      if (contextFilter && sub.context !== contextFilter) return false;
      return true;
    }),
  );

  const PENDING_STATUSES = new Set(["pending_upload", "queued", "compiling", "running"]);
  const pendingIds = $derived(
    allRows.filter((sub) => PENDING_STATUSES.has(sub.status)).map((sub) => sub.id),
  );

  function openSubmission(id: string) {
    void goto(`/submissions/${id}`);
  }

  function handleRowKeydown(event: KeyboardEvent, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSubmission(id);
  }

  function selectValue(value: string | undefined): string {
    return value === "__all" || value === undefined ? "" : value;
  }

  $effect(() => {
    if (pendingIds.length === 0) return;
    const unwatchers = pendingIds.map((id) =>
      watchSubmissionVerdict(id, () => {
        void invalidateAll();
      }),
    );
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void invalidateAll();
    }, 5000);
    return () => {
      for (const unwatch of unwatchers) unwatch();
      clearInterval(interval);
    };
  });
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

    {#if allRows.length === 0}
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
      <div class="overflow-x-auto">
        <table class="w-full text-body-sm">
          <thead
            class="bg-muted/40 font-mono text-micro uppercase tracking-wider text-muted-foreground"
          >
            <tr>
              <th class="px-4 py-2.5 text-left font-medium">{m.admin_submissions_colTime()}</th>
              <th class="px-2 py-1.5 text-left font-medium">
                <Select.Root
                  type="single"
                  value={problemFilter || "__all"}
                  onValueChange={(value) => (problemFilter = selectValue(value))}
                >
                  <Select.Trigger
                    class="h-8 max-w-48 border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border"
                    aria-label={m.submissions_filterProblem()}
                  >
                    {problemFilter
                      ? (problemOptions.find(([id]) => id === problemFilter)?.[1] ??
                        m.admin_submissions_colProblem())
                      : m.admin_submissions_colProblem()}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="__all" label={m.admin_submissions_colProblem()}
                      >{m.admin_submissions_colProblem()}</Select.Item
                    >
                    {#each problemOptions as [id, title] (id)}
                      <Select.Item value={id} label={title}>{title}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </th>
              <th class="px-2 py-1.5 text-left font-medium">
                <Select.Root
                  type="single"
                  value={contextFilter || "__all"}
                  onValueChange={(value) => (contextFilter = selectValue(value))}
                >
                  <Select.Trigger
                    class="h-8 border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border"
                    aria-label={m.admin_submissions_colContext()}
                  >
                    {contextFilter
                      ? contextLabel(contextFilter as SubmissionRow["context"])
                      : m.admin_submissions_colContext()}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="__all" label={m.admin_submissions_colContext()}
                      >{m.admin_submissions_colContext()}</Select.Item
                    >
                    {#each contextOptions as context (context)}
                      <Select.Item value={context} label={contextLabel(context)}
                        >{contextLabel(context)}</Select.Item
                      >
                    {/each}
                  </Select.Content>
                </Select.Root>
              </th>
              <th class="px-2 py-1.5 text-left font-medium">
                <Select.Root
                  type="single"
                  value={languageFilter || "__all"}
                  onValueChange={(value) => (languageFilter = selectValue(value))}
                >
                  <Select.Trigger
                    class="h-8 border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border"
                    aria-label={m.submissions_filterLanguage()}
                  >
                    {languageFilter
                      ? displayLanguage(languageFilter)
                      : m.submissions_filterLanguage()}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="__all" label={m.submissions_filterLanguage()}
                      >{m.submissions_filterLanguage()}</Select.Item
                    >
                    {#each languageOptions as lang (lang)}
                      <Select.Item value={lang} label={displayLanguage(lang)}
                        >{displayLanguage(lang)}</Select.Item
                      >
                    {/each}
                  </Select.Content>
                </Select.Root>
              </th>
              <th class="px-2 py-1.5 text-left font-medium">
                <Select.Root
                  type="single"
                  value={verdictFilter || "__all"}
                  onValueChange={(value) => (verdictFilter = selectValue(value))}
                >
                  <Select.Trigger
                    class="h-8 border-transparent bg-transparent px-1 font-mono text-micro uppercase tracking-wider hover:border-border"
                    aria-label={m.submissions_filterVerdict()}
                  >
                    {verdictFilter
                      ? formatVerdictLabel(verdictFilter)
                      : m.admin_submissions_colVerdict()}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="__all" label={m.admin_submissions_colVerdict()}
                      >{m.admin_submissions_colVerdict()}</Select.Item
                    >
                    {#each verdictOptions as status (status)}
                      <Select.Item value={status} label={formatVerdictLabel(status)}
                        >{formatVerdictLabel(status)}</Select.Item
                      >
                    {/each}
                  </Select.Content>
                </Select.Root>
              </th>
              <th class="px-3 py-2.5 text-right font-medium"
                >{m.admin_submissions_colScore()}</th
              >
            </tr>
          </thead>
          <tbody>
            {#if filtered.length === 0}
              <tr class="border-t border-border-subtle">
                <td class="px-6 py-14 text-center text-muted-foreground" colspan="6">
                  {m.submissions_noMatches()}
                </td>
              </tr>
            {:else}
              {#each filtered as sub (sub.id)}
                <tr
                  class="cursor-pointer border-t border-border-subtle transition-colors hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
                  role="link"
                  tabindex="0"
                  onclick={() => openSubmission(sub.id)}
                  onkeydown={(event) => handleRowKeydown(event, sub.id)}
                >
                  <td
                    class="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted-foreground"
                  >
                    {formatDateTime(sub.createdAt)}
                  </td>
                  <td class="px-3 py-3">
                    <span class="font-medium">{sub.problemTitle}</span>
                  </td>
                  <td class="px-3 py-3 text-caption text-muted-foreground">
                    {contextLabel(sub.context)}
                  </td>
                  <td
                    class="whitespace-nowrap px-3 py-3 font-mono text-caption text-muted-foreground"
                  >
                    {languageLabel(sub.language)}
                  </td>
                  <td class="px-3 py-3">
                    {#if PENDING_STATUSES.has(sub.status)}
                      <span
                        class="inline-flex items-center gap-1.5 text-caption text-muted-foreground"
                      >
                        <span
                          class="size-3.5 animate-spin rounded-full border-2 border-border border-t-foreground"
                          aria-hidden="true"
                        ></span>
                        {m.submission_pending()}
                      </span>
                    {:else}
                      <VerdictBadge verdict={sub.status} />
                    {/if}
                  </td>
                  <td class="px-3 py-3 text-right font-mono tabular-nums">
                    <span class="text-body-sm font-semibold text-foreground">{sub.score}</span>
                    <span class="text-caption text-muted-foreground">/{sub.totalScore}</span>
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      {#if activeCursor}
        <div class="mt-4 flex justify-center">
          <button
            class="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 py-2 text-body-sm font-medium transition-[background-color] duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={loadingMore}
            onclick={loadMore}
          >
            {#if loadingMore}
              <span
                class="size-3.5 animate-spin rounded-full border-2 border-border border-t-foreground"
                aria-hidden="true"
              ></span>
              {m.submissions_loadingMore()}
            {:else}
              {m.submissions_loadMore()}
            {/if}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</PageContainer>
