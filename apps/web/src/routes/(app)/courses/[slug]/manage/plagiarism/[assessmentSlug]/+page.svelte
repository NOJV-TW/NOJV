<script lang="ts">
  import { ShieldAlert } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let { data } = $props();

  let threshold = $state(50);

  interface SimilarityPair {
    linesMatched: number;
    mossUrl: string;
    problemId: string;
    similarity1: number;
    similarity2: number;
    userId1: string;
    userId2: string;
  }

  const latestReport = $derived(data.reports[0] ?? null);
  const pairs = $derived<SimilarityPair[]>(
    (latestReport?.results as { pairs?: SimilarityPair[] })?.pairs ?? []
  );
  const filteredPairs = $derived(
    pairs
      .filter((p) => Math.max(p.similarity1, p.similarity2) >= threshold)
      .sort((a, b) => Math.max(b.similarity1, b.similarity2) - Math.max(a.similarity1, a.similarity2))
  );

  function memberLabel(userId: string): string {
    const member = data.memberMap[userId];
    if (!member) return userId.slice(0, 8);
    return member.username ?? member.displayName;
  }

  function problemLabel(problemId: string): string {
    const problem = data.problemMap[problemId];
    return problem?.title ?? problemId.slice(0, 8);
  }

  function statusBadgeVariant(status: string): "success" | "destructive" | "warning" | "muted" {
    switch (status) {
      case "completed": return "success";
      case "failed": return "destructive";
      case "running": return "warning";
      default: return "muted";
    }
  }

  // Side-by-side comparison state
  let comparisonPair = $state<SimilarityPair | null>(null);
  let sourceCode1 = $state<string | null>(null);
  let sourceCode2 = $state<string | null>(null);
  let loadingComparison = $state(false);

  async function showComparison(pair: SimilarityPair) {
    comparisonPair = pair;
    sourceCode1 = null;
    sourceCode2 = null;
    loadingComparison = true;

    try {
      // Fetch best submission source for each user+problem pair
      const [res1, res2] = await Promise.all([
        fetchBestSource(pair.userId1, pair.problemId),
        fetchBestSource(pair.userId2, pair.problemId)
      ]);
      sourceCode1 = res1;
      sourceCode2 = res2;
    } catch {
      sourceCode1 = "Failed to load source code.";
      sourceCode2 = "Failed to load source code.";
    } finally {
      loadingComparison = false;
    }
  }

  async function fetchBestSource(userId: string, problemId: string): Promise<string> {
    const res = await fetch(
      `/api/plagiarism/${data.assessment.id}?source=true&userId=${userId}&problemId=${problemId}`
    );
    if (!res.ok) return "(source not available)";
    const json = await res.json();
    return json.sourceCode ?? "(empty)";
  }

  function closeComparison() {
    comparisonPair = null;
  }
</script>

<div class="space-y-6">
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 shadow-rest backdrop-blur-sm"
  >
    <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
      {m.plagiarism_title()}
    </p>
    <h2 class="mt-2 font-display text-title-lg">
      {data.assessment.title}
    </h2>
    <a
      href="/courses/{data.courseSlug}/manage/assessments"
      class="mt-4 inline-block text-body-sm text-muted-foreground hover:underline"
    >
      {m.plagiarism_backToAssessments()}
    </a>
  </section>

  {#if latestReport}
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 shadow-rest backdrop-blur-sm"
    >
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-title font-semibold">{m.plagiarism_report()}</h3>
        <Badge variant={statusBadgeVariant(latestReport.status)} dot>
          {latestReport.status}
        </Badge>
      </div>

      <div class="mt-3 text-body-sm text-muted-foreground">
        {#if latestReport.triggeredAt}
          <p class="tabular-nums">{m.plagiarism_triggered()}: {new Date(latestReport.triggeredAt).toLocaleString()}</p>
        {/if}
        {#if latestReport.completedAt}
          <p class="tabular-nums">{m.plagiarism_completed()}: {new Date(latestReport.completedAt).toLocaleString()}</p>
        {/if}
        {#if latestReport.mossReportUrl}
          <p class="mt-1">
            <a
              href={latestReport.mossReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-foreground"
            >
              {m.plagiarism_mossReport()}
            </a>
          </p>
        {/if}
      </div>

      {#if latestReport.status === "completed" && pairs.length > 0}
        <div class="mt-5">
          <label class="flex items-center gap-3 text-body-sm">
            <span class="tabular-nums">{m.plagiarism_similarityThreshold()}: {threshold}%</span>
            <input
              type="range"
              min="0"
              max="100"
              bind:value={threshold}
              class="w-48"
            />
          </label>
        </div>

        <div class="mt-4 overflow-x-auto rounded-xl border border-border-subtle">
          <table class="w-full text-body-sm">
            <thead>
              <tr class="border-b border-border-subtle text-left text-muted-foreground">
                <th class="px-3 py-2">{m.plagiarism_student1()}</th>
                <th class="px-3 py-2">{m.plagiarism_student2()}</th>
                <th class="px-3 py-2">{m.plagiarism_problem()}</th>
                <th class="px-3 py-2">{m.plagiarism_similarity()}</th>
                <th class="px-3 py-2">{m.plagiarism_lines()}</th>
                <th class="px-3 py-2">{m.plagiarism_actions()}</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredPairs as pair (pair.userId1 + pair.userId2 + pair.problemId)}
                <tr class="border-b border-border-subtle/50 hover:bg-[color:var(--color-panel-strong)]/30">
                  <td class="px-3 py-2 font-mono text-caption">{memberLabel(pair.userId1)}</td>
                  <td class="px-3 py-2 font-mono text-caption">{memberLabel(pair.userId2)}</td>
                  <td class="px-3 py-2">{problemLabel(pair.problemId)}</td>
                  <td class="px-3 py-2">
                    <span class="font-semibold tabular-nums {Math.max(pair.similarity1, pair.similarity2) >= 80 ? 'text-destructive' : Math.max(pair.similarity1, pair.similarity2) >= 50 ? 'text-warning' : ''}">
                      {pair.similarity1}% / {pair.similarity2}%
                    </span>
                  </td>
                  <td class="px-3 py-2 tabular-nums">{pair.linesMatched}</td>
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-2">
                      <button
                        class="text-caption underline hover:text-foreground"
                        onclick={() => showComparison(pair)}
                      >
                        {m.plagiarism_compare()}
                      </button>
                      {#if pair.mossUrl && pair.mossUrl.startsWith("http")}
                        <a
                          href={pair.mossUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-caption underline hover:text-foreground"
                        >
                          MOSS
                        </a>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          {#if filteredPairs.length === 0}
            <p class="mt-4 text-center text-body-sm text-muted-foreground">
              {m.plagiarism_noPairsAboveThreshold({ threshold: String(threshold) })}
            </p>
          {/if}
        </div>
      {:else if latestReport.status === "completed"}
        <p class="mt-4 text-body-sm text-muted-foreground">{m.plagiarism_noSimilarityPairs()}</p>
      {:else if latestReport.status === "pending" || latestReport.status === "running"}
        <p class="mt-4 text-body-sm text-muted-foreground">{m.plagiarism_checkInProgress()}</p>
      {:else if latestReport.status === "failed"}
        <p class="mt-4 text-body-sm text-destructive">{m.plagiarism_checkFailed()}</p>
      {/if}
    </section>
  {:else}
    <EmptyState
      icon={ShieldAlert}
      title={m.plagiarism_noReportsTitle()}
      description={m.plagiarism_noReportsDescription()}
    />
  {/if}

  {#if comparisonPair}
    <section
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-5 py-5 shadow-rest backdrop-blur-sm"
    >
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-title-sm font-semibold">
          {m.plagiarism_sideBySide()}: {memberLabel(comparisonPair.userId1)} vs {memberLabel(comparisonPair.userId2)}
          ({problemLabel(comparisonPair.problemId)})
        </h3>
        <Button variant="outline" size="sm" onclick={closeComparison}>
          {m.plagiarism_close()}
        </Button>
      </div>

      {#if loadingComparison}
        <p class="mt-4 text-body-sm text-muted-foreground">{m.plagiarism_loadingSource()}</p>
      {:else}
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p class="mb-2 text-caption font-semibold text-muted-foreground">
              {memberLabel(comparisonPair.userId1)}
            </p>
            <pre class="max-h-96 overflow-auto rounded-xl border border-border-subtle bg-muted p-3 text-caption"><code>{sourceCode1}</code></pre>
          </div>
          <div>
            <p class="mb-2 text-caption font-semibold text-muted-foreground">
              {memberLabel(comparisonPair.userId2)}
            </p>
            <pre class="max-h-96 overflow-auto rounded-xl border border-border-subtle bg-muted p-3 text-caption"><code>{sourceCode2}</code></pre>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>
