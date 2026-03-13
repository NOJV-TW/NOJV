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
          <span class="text-sm text-emerald-700">Connected</span>
        </div>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-red-500"></span>
          <span class="text-sm text-red-700">Disconnected</span>
        </div>
        {#if data.dbError}
          <p class="mt-1 text-xs text-red-600">{data.dbError}</p>
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
          <span class="text-sm text-emerald-700">Connected</span>
        </div>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-red-500"></span>
          <span class="text-sm text-red-700">Unavailable</span>
        </div>
        {#if data.queueError}
          <p class="mt-1 text-xs text-red-600">{data.queueError}</p>
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
          <div class="rounded-2xl border border-border bg-white/60 px-4 py-3 text-center">
            <p class="text-2xl font-bold">{count}</p>
            <p class="text-xs text-muted-foreground">{statusLabels[key] ?? key}</p>
          </div>
        {/each}
      </div>
    </div>
  {/if}

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
                    class="rounded-full px-2 py-0.5 text-xs font-medium {sub.status === 'compile_error' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}"
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
