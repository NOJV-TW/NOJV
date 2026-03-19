<script lang="ts">
  let { data } = $props();

  const statusLabels: Record<string, string> = {
    waiting: "Waiting",
    active: "Active",
    completed: "Completed",
    failed: "Failed",
    delayed: "Delayed",
    paused: "Paused",
    prioritized: "Prioritized",
    "waiting-children": "Waiting Children"
  };

  const jobStatuses = ["waiting", "active", "completed", "failed", "delayed"] as const;

  function formatTimestamp(ms: number | undefined): string {
    if (!ms) return "-";
    return new Date(ms).toLocaleString();
  }

  function formatDuration(start: number | undefined, end: number | undefined): string {
    if (!start || !end) return "-";
    const diff = end - start;
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s`;
    return `${(diff / 60_000).toFixed(1)}m`;
  }

  function truncateId(id: string | undefined): string {
    if (!id) return "-";
    return id.length > 12 ? id.slice(0, 12) + "..." : id;
  }
</script>

<div class="space-y-6">
  <!-- Connection Status -->
  <div class="grid gap-4 md:grid-cols-2">
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
    >
      <h3 class="text-lg font-semibold">Database</h3>
      {#if data.dbOk}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-emerald-500"></span>
          <span class="text-sm text-emerald-700 dark:text-emerald-400">Connected</span>
        </div>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-red-500"></span>
          <span class="text-sm text-red-700 dark:text-red-400">Disconnected</span>
        </div>
        {#if data.dbError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{data.dbError}</p>
        {/if}
      {/if}
    </div>

    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
    >
      <h3 class="text-lg font-semibold">Redis / BullMQ</h3>
      {#if data.queueCounts}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-emerald-500"></span>
          <span class="text-sm text-emerald-700 dark:text-emerald-400">Connected</span>
        </div>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-red-500"></span>
          <span class="text-sm text-red-700 dark:text-red-400">Unavailable</span>
        </div>
        {#if data.queueError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{data.queueError}</p>
        {/if}
      {/if}
    </div>
  </div>

  <!-- Queue Counts -->
  {#if data.queueCounts}
    <div
      class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
    >
      <h3 class="text-lg font-semibold">Submission Queue</h3>
      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each Object.entries(data.queueCounts) as [key, count] (key)}
          <div class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-4 py-3 text-center">
            <p class="text-2xl font-bold">{count}</p>
            <p class="text-xs text-muted-foreground">{statusLabels[key] ?? key}</p>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Queue Jobs -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold">Queue Jobs</h3>
      <form method="POST" action="?/cleanJobs">
        <input type="hidden" name="status" value={data.jobStatus} />
        <button
          type="submit"
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
        >
          Clean all {statusLabels[data.jobStatus] ?? data.jobStatus}
        </button>
      </form>
    </div>

    <!-- Status Tabs -->
    <div class="mt-4 flex gap-2">
      {#each jobStatuses as status}
        <a
          href="?jobStatus={status}"
          class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
            {data.jobStatus === status
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'}"
        >
          {statusLabels[status]}
        </a>
      {/each}
    </div>

    <!-- Jobs Table -->
    {#if data.queueJobs.length > 0}
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left">
              <th class="px-4 py-2 font-medium">ID</th>
              <th class="px-4 py-2 font-medium">Name</th>
              <th class="px-4 py-2 font-medium">Created</th>
              <th class="px-4 py-2 font-medium">Duration</th>
              <th class="px-4 py-2 font-medium">Attempts</th>
              <th class="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each data.queueJobs as job (job.id)}
              <tr class="border-b border-border last:border-b-0">
                <td class="px-4 py-2 font-mono text-xs" title={job.id}>
                  {truncateId(job.id)}
                </td>
                <td class="px-4 py-2 text-xs">{job.name}</td>
                <td class="px-4 py-2 text-xs text-muted-foreground">
                  {formatTimestamp(job.timestamp)}
                </td>
                <td class="px-4 py-2 text-xs text-muted-foreground">
                  {formatDuration(job.processedOn, job.finishedOn)}
                </td>
                <td class="px-4 py-2 text-xs text-center">{job.attemptsMade}</td>
                <td class="flex gap-1 px-4 py-2">
                  {#if data.jobStatus === "failed"}
                    <form method="POST" action="?/retryJob">
                      <input type="hidden" name="jobId" value={job.id} />
                      <button
                        type="submit"
                        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
                      >
                        Retry
                      </button>
                    </form>
                  {/if}
                  <form method="POST" action="?/removeJob">
                    <input type="hidden" name="jobId" value={job.id} />
                    <button
                      type="submit"
                      class="rounded-md border border-border px-2 py-1 text-xs hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
              {#if data.jobStatus === "failed" && job.failedReason}
                <tr class="border-b border-border last:border-b-0">
                  <td colspan="6" class="px-4 pb-3 pt-0">
                    <details class="text-xs">
                      <summary class="cursor-pointer text-muted-foreground hover:text-foreground">
                        Error details
                      </summary>
                      <pre class="mt-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs text-red-600 dark:text-red-400">{job.failedReason}</pre>
                    </details>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="mt-4 text-sm text-muted-foreground">
        No {statusLabels[data.jobStatus]?.toLowerCase() ?? data.jobStatus} jobs found.
      </p>
    {/if}
  </div>

  <!-- Failed Submissions -->
  <div
    class="rounded-[2rem] border border-border bg-[color:var(--color-panel)] px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="text-lg font-semibold">Recent Error Submissions</h3>
    <p class="mt-1 text-sm text-muted-foreground">
      Last 50 submissions with compile_error or runtime_error status.
    </p>

    {#if data.failedSubmissions.length > 0}
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left">
              <th class="px-4 py-2 font-medium">Problem</th>
              <th class="px-4 py-2 font-medium">User</th>
              <th class="px-4 py-2 font-medium">Language</th>
              <th class="px-4 py-2 font-medium">Status</th>
              <th class="px-4 py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {#each data.failedSubmissions as sub (sub.id)}
              <tr class="border-b border-border last:border-b-0">
                <td class="px-4 py-2">
                  <a class="text-primary hover:underline" href="/problems/{sub.problem.slug}">
                    {sub.problem.defaultTitle}
                  </a>
                </td>
                <td class="px-4 py-2 font-mono text-xs">{sub.user.username ?? sub.user.name}</td>
                <td class="px-4 py-2 text-xs">{sub.language}</td>
                <td class="px-4 py-2">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-medium {sub.status === 'compile_error' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}"
                  >
                    {sub.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td class="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(sub.createdAt).toLocaleString()}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="mt-4 text-sm text-muted-foreground">No error submissions found.</p>
    {/if}
  </div>
</div>
