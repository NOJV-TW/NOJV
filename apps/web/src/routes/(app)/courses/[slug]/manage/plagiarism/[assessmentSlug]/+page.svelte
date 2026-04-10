<script lang="ts">
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

  function statusColor(status: string): string {
    switch (status) {
      case "completed": return "text-emerald-700 dark:text-emerald-400";
      case "failed": return "text-red-700 dark:text-red-400";
      case "running": return "text-amber-700 dark:text-amber-400";
      default: return "text-muted-foreground";
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
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 backdrop-blur-sm"
  >
    <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
      Plagiarism Check
    </p>
    <h2 class="mt-2 font-[family-name:var(--font-display)] text-3xl">
      {data.assessment.title}
    </h2>
    <a
      href="/courses/{data.courseSlug}/manage/assessments"
      class="mt-4 inline-block text-sm text-muted-foreground hover:underline"
    >
      &larr; Back to assessments
    </a>
  </section>

  {#if latestReport}
    <section
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
    >
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-2xl font-semibold">Report</h3>
        <span class="rounded-full border border-border px-3 py-1 text-xs font-medium {statusColor(latestReport.status)}">
          {latestReport.status}
        </span>
      </div>

      <div class="mt-3 text-sm text-muted-foreground">
        {#if latestReport.triggeredAt}
          <p>Triggered: {new Date(latestReport.triggeredAt).toLocaleString()}</p>
        {/if}
        {#if latestReport.completedAt}
          <p>Completed: {new Date(latestReport.completedAt).toLocaleString()}</p>
        {/if}
        {#if latestReport.mossReportUrl}
          <p class="mt-1">
            <a
              href={latestReport.mossReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-foreground"
            >
              MOSS Report
            </a>
          </p>
        {/if}
      </div>

      {#if latestReport.status === "completed" && pairs.length > 0}
        <div class="mt-5">
          <label class="flex items-center gap-3 text-sm">
            <span>Similarity threshold: {threshold}%</span>
            <input
              type="range"
              min="0"
              max="100"
              bind:value={threshold}
              class="w-48"
            />
          </label>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border text-left text-muted-foreground">
                <th class="px-3 py-2">Student 1</th>
                <th class="px-3 py-2">Student 2</th>
                <th class="px-3 py-2">Problem</th>
                <th class="px-3 py-2">Similarity</th>
                <th class="px-3 py-2">Lines</th>
                <th class="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredPairs as pair}
                <tr class="border-b border-border/50 hover:bg-[color:var(--color-panel-strong)]/30">
                  <td class="px-3 py-2 font-mono text-xs">{memberLabel(pair.userId1)}</td>
                  <td class="px-3 py-2 font-mono text-xs">{memberLabel(pair.userId2)}</td>
                  <td class="px-3 py-2">{problemLabel(pair.problemId)}</td>
                  <td class="px-3 py-2">
                    <span class="font-semibold {Math.max(pair.similarity1, pair.similarity2) >= 80 ? 'text-red-700 dark:text-red-400' : Math.max(pair.similarity1, pair.similarity2) >= 50 ? 'text-amber-700 dark:text-amber-400' : ''}">
                      {pair.similarity1}% / {pair.similarity2}%
                    </span>
                  </td>
                  <td class="px-3 py-2">{pair.linesMatched}</td>
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-2">
                      <button
                        class="text-xs underline hover:text-foreground"
                        onclick={() => showComparison(pair)}
                      >
                        Compare
                      </button>
                      {#if pair.mossUrl && pair.mossUrl.startsWith("http")}
                        <a
                          href={pair.mossUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-xs underline hover:text-foreground"
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
            <p class="mt-4 text-center text-sm text-muted-foreground">
              No pairs above {threshold}% similarity threshold.
            </p>
          {/if}
        </div>
      {:else if latestReport.status === "completed"}
        <p class="mt-4 text-sm text-muted-foreground">No similarity pairs found.</p>
      {:else if latestReport.status === "pending" || latestReport.status === "running"}
        <p class="mt-4 text-sm text-muted-foreground">Check is in progress. Refresh the page to see updated results.</p>
      {:else if latestReport.status === "failed"}
        <p class="mt-4 text-sm text-red-700 dark:text-red-400">The plagiarism check failed. Try running it again.</p>
      {/if}
    </section>
  {:else}
    <section
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
    >
      <p class="text-sm text-muted-foreground">
        No plagiarism reports yet. Run a check from the assessments page.
      </p>
    </section>
  {/if}

  {#if comparisonPair}
    <section
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
    >
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-lg font-semibold">
          Side-by-Side: {memberLabel(comparisonPair.userId1)} vs {memberLabel(comparisonPair.userId2)}
          ({problemLabel(comparisonPair.problemId)})
        </h3>
        <button
          class="rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:-translate-y-0.5"
          onclick={closeComparison}
        >
          Close
        </button>
      </div>

      {#if loadingComparison}
        <p class="mt-4 text-sm text-muted-foreground">Loading source code...</p>
      {:else}
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p class="mb-2 text-xs font-semibold text-muted-foreground">
              {memberLabel(comparisonPair.userId1)}
            </p>
            <pre class="max-h-96 overflow-auto rounded-xl border border-border bg-muted p-3 text-xs"><code>{sourceCode1}</code></pre>
          </div>
          <div>
            <p class="mb-2 text-xs font-semibold text-muted-foreground">
              {memberLabel(comparisonPair.userId2)}
            </p>
            <pre class="max-h-96 overflow-auto rounded-xl border border-border bg-muted p-3 text-xs"><code>{sourceCode2}</code></pre>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>
