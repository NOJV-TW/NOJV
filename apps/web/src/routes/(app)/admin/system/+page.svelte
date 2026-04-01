<script lang="ts">
  import { browser } from "$app/environment";
  import {
    AlertTriangle,
    Database,
    Languages,
    ListChecks,
    Server,
    Wrench
  } from "@lucide/svelte";
  import { onMount } from "svelte";

  let { data } = $props();

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      actions: "Actions",
      active: "Active",
      attempts: "Attempts",
      cleanAll: "Clean all",
      completed: "Completed",
      connected: "Connected",
      created: "Created",
      database: "Database",
      delayed: "Delayed",
      disconnected: "Disconnected",
      duration: "Duration",
      english: "English",
      errorDetails: "Error details",
      failed: "Failed",
      jobName: "Name",
      noErrorSubmissions: "No error submissions found.",
      noJobs: "No jobs found.",
      queueJobs: "Queue Jobs",
      queueStatus: "Submission Queue",
      recentErrors: "Recent Error Submissions",
      redis: "Redis / BullMQ",
      remove: "Remove",
      retry: "Retry",
      status: "Status",
      submissionQueue: "Submission Queue",
      systemText: "System Text",
      time: "Time",
      unavailable: "Unavailable",
      user: "User",
      waiting: "Waiting",
      zh: "中文"
    },
    zh: {
      actions: "操作",
      active: "執行中",
      attempts: "嘗試次數",
      cleanAll: "清除全部",
      completed: "完成",
      connected: "連線正常",
      created: "建立時間",
      database: "資料庫",
      delayed: "延遲",
      disconnected: "連線失敗",
      duration: "耗時",
      english: "English",
      errorDetails: "錯誤詳細",
      failed: "失敗",
      jobName: "名稱",
      noErrorSubmissions: "目前沒有錯誤提交。",
      noJobs: "目前沒有符合條件的任務。",
      queueJobs: "佇列任務",
      queueStatus: "提交佇列",
      recentErrors: "近期錯誤提交",
      redis: "Redis / BullMQ",
      remove: "移除",
      retry: "重試",
      status: "狀態",
      submissionQueue: "提交佇列",
      systemText: "系統文字",
      time: "時間",
      unavailable: "無法連線",
      user: "使用者",
      waiting: "等待中",
      zh: "中文"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  onMount(() => {
    if (!browser) return;
    const saved = localStorage.getItem("nojv-system-text-lang");
    if (saved === "zh" || saved === "en") {
      uiLang = saved;
    }
  });

  function setUiLang(next: UiLang): void {
    uiLang = next;
    if (browser) {
      localStorage.setItem("nojv-system-text-lang", next);
    }
  }

  const statusLabels = $derived.by<Record<string, string>>(() => ({
    waiting: t("waiting"),
    active: t("active"),
    completed: t("completed"),
    failed: t("failed"),
    delayed: t("delayed"),
    paused: "paused",
    prioritized: "prioritized",
    "waiting-children": "waiting-children"
  }));

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
  <div class="flex justify-end">
    <div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
      <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
        <Languages class="h-3.5 w-3.5" /> {t("systemText")}
      </span>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => setUiLang("zh")}
      >
        {t("zh")}
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => setUiLang("en")}
      >
        {t("english")}
      </button>
    </div>
  </div>

  <!-- Connection Status -->
  <div class="grid gap-4 md:grid-cols-2">
    <div
      class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
    >
      <h3 class="inline-flex items-center gap-1 text-lg font-semibold"><Database class="h-4 w-4 text-muted-foreground" /> {t("database")}</h3>
      {#if data.dbOk}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-emerald-500"></span>
          <span class="text-sm text-emerald-700 dark:text-emerald-400">{t("connected")}</span>
        </div>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-red-500"></span>
          <span class="text-sm text-red-700 dark:text-red-400">{t("disconnected")}</span>
        </div>
        {#if data.dbError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{data.dbError}</p>
        {/if}
      {/if}
    </div>

    <div
      class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
    >
      <h3 class="inline-flex items-center gap-1 text-lg font-semibold"><Server class="h-4 w-4 text-muted-foreground" /> {t("redis")}</h3>
      {#if data.queueCounts}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-emerald-500"></span>
          <span class="text-sm text-emerald-700 dark:text-emerald-400">{t("connected")}</span>
        </div>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <span class="inline-block h-3 w-3 rounded-full bg-red-500"></span>
          <span class="text-sm text-red-700 dark:text-red-400">{t("unavailable")}</span>
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
      class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
    >
      <h3 class="inline-flex items-center gap-1 text-lg font-semibold"><ListChecks class="h-4 w-4 text-muted-foreground" /> {t("submissionQueue")}</h3>
      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each Object.entries(data.queueCounts) as [key, count] (key)}
          <div class="rounded-2xl border border-border bg-(--color-panel) px-4 py-3 text-center">
            <p class="text-2xl font-bold">{count}</p>
            <p class="text-xs text-muted-foreground">{statusLabels[key] ?? key}</p>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Queue Jobs -->
  <div
    class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between">
      <h3 class="inline-flex items-center gap-1 text-lg font-semibold"><Wrench class="h-4 w-4 text-muted-foreground" /> {t("queueJobs")}</h3>
      <form method="POST" action="?/cleanJobs">
        <input type="hidden" name="status" value={data.jobStatus} />
        <button
          type="submit"
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
        >
          {t("cleanAll")} {statusLabels[data.jobStatus] ?? data.jobStatus}
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
              <th class="px-4 py-2 font-medium">{t("jobName")}</th>
              <th class="px-4 py-2 font-medium">{t("created")}</th>
              <th class="px-4 py-2 font-medium">{t("duration")}</th>
              <th class="px-4 py-2 font-medium">{t("attempts")}</th>
              <th class="px-4 py-2 font-medium">{t("actions")}</th>
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
                        {t("retry")}
                      </button>
                    </form>
                  {/if}
                  <form method="POST" action="?/removeJob">
                    <input type="hidden" name="jobId" value={job.id} />
                    <button
                      type="submit"
                      class="rounded-md border border-border px-2 py-1 text-xs hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    >
                      {t("remove")}
                    </button>
                  </form>
                </td>
              </tr>
              {#if data.jobStatus === "failed" && job.failedReason}
                <tr class="border-b border-border last:border-b-0">
                  <td colspan="6" class="px-4 pb-3 pt-0">
                    <details class="text-xs">
                      <summary class="cursor-pointer text-muted-foreground hover:text-foreground">
                        {t("errorDetails")}
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
        {t("noJobs")}
      </p>
    {/if}
  </div>

  <!-- Failed Submissions -->
  <div
    class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="inline-flex items-center gap-1 text-lg font-semibold"><AlertTriangle class="h-4 w-4 text-muted-foreground" /> {t("recentErrors")}</h3>
    <p class="mt-1 text-sm text-muted-foreground">
      Last 50 submissions with compile_error or runtime_error status.
    </p>

    {#if data.failedSubmissions.length > 0}
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left">
              <th class="px-4 py-2 font-medium">Problem</th>
              <th class="px-4 py-2 font-medium">{t("user")}</th>
              <th class="px-4 py-2 font-medium">Language</th>
              <th class="px-4 py-2 font-medium">{t("status")}</th>
              <th class="px-4 py-2 font-medium">{t("time")}</th>
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
      <p class="mt-4 text-sm text-muted-foreground">{t("noErrorSubmissions")}</p>
    {/if}
  </div>
</div>
