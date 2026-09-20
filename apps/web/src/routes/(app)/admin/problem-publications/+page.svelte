<script lang="ts">
  import { enhance } from "$app/forms";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { FileCheck2 } from "@lucide/svelte";

  let { data, form } = $props();

  function statusLabel(status: (typeof data.requests)[number]["status"]): string {
    if (status === "pending") return m.problem_publicationRequestPending();
    if (status === "approved") return m.admin_problemPublicationsApproved();
    return m.admin_problemPublicationsRejected();
  }

  function statusClass(status: (typeof data.requests)[number]["status"]): string {
    if (status === "pending") return "border-warning/40 bg-warning/10 text-warning";
    if (status === "approved") return "border-success/40 bg-success/10 text-success";
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
</script>

<PageHeader
  eyebrow={m.admin_eyebrow()}
  title={m.admin_problemPublicationsTitle()}
  description={m.admin_problemPublicationsSubtitle()}
/>

<Card variant="surface" size="lg">
  {#if form?.error}
    <div
      class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body-sm text-destructive"
      role="alert"
    >
      {form.error}
    </div>
  {/if}

  <nav
    class="mb-4 flex gap-6 border-b border-border-subtle"
    aria-label={m.admin_problemPublicationsQueueNavigation()}
  >
    <a
      href="/admin/problem-publications"
      aria-current={data.status === "pending" ? "page" : undefined}
      class={`-mb-px border-b-2 px-1 pb-3 text-body-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${data.status === "pending" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {m.admin_problemPublicationsPending()}
    </a>
    <a
      href="/admin/problem-publications?status=closed"
      aria-current={data.status === "closed" ? "page" : undefined}
      class={`-mb-px border-b-2 px-1 pb-3 text-body-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${data.status === "closed" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {m.admin_problemPublicationsClosed()}
    </a>
  </nav>

  {#if data.requests.length === 0}
    <EmptyState
      variant="onboarding"
      icon={FileCheck2}
      title={data.status === "pending"
        ? m.admin_problemPublicationsPendingEmpty()
        : m.admin_problemPublicationsClosedEmpty()}
      description={data.status === "pending"
        ? m.admin_problemPublicationsEmptyHint()
        : m.admin_problemPublicationsClosedEmptyHint()}
    />
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-body-sm">
        <thead>
          <tr
            class="border-b border-border-subtle text-left text-caption text-muted-foreground"
          >
            <th class="px-3 py-3 font-medium">{m.admin_problemPublicationsAuthor()}</th>
            <th class="px-3 py-3 font-medium">{m.admin_problemPublicationsRequester()}</th>
            <th class="px-3 py-3 font-medium">{m.admin_problemPublicationsStatus()}</th>
            <th class="px-3 py-3 font-medium">{m.admin_overviewTime()}</th>
            <th class="px-3 py-3 text-right font-medium"
              >{m.admin_problemPublicationsViewProblem()}</th
            >
          </tr>
        </thead>
        <tbody>
          {#each data.requests as request (request.id)}
            <tr class="border-b border-border-subtle align-top">
              <td class="px-3 py-3">
                <a
                  class="text-primary hover:underline"
                  href={`/problems/${request.problem.id}/edit`}
                >
                  <span class="font-medium">{request.problem.displayId ?? "—"}</span>
                  <span class="text-muted-foreground"> · {request.problem.title}</span>
                </a>
                <div class="mt-1 text-caption text-muted-foreground">
                  {request.author.name}
                  {#if request.author.username}
                    · @{request.author.username}{/if}
                </div>
              </td>
              <td class="px-3 py-3">
                <div>{request.requester.name}</div>
                {#if request.requester.username}
                  <div class="text-caption text-muted-foreground">
                    @{request.requester.username}
                  </div>
                {/if}
              </td>
              <td class="px-3 py-3">
                <span
                  class={`inline-flex rounded-full border px-2 py-0.5 text-caption ${statusClass(request.status)}`}
                >
                  {statusLabel(request.status)}
                </span>
                {#if request.reviewNote}
                  <p
                    class="mt-1 max-w-xs whitespace-pre-wrap text-caption text-muted-foreground"
                  >
                    {request.reviewNote}
                  </p>
                {/if}
              </td>
              <td class="px-3 py-3 tabular-nums text-muted-foreground">
                {formatDateTime(request.createdAt)}
                {#if request.reviewedAt}
                  <div class="text-caption">{formatDateTime(request.reviewedAt)}</div>
                {/if}
              </td>
              <td class="px-3 py-3">
                {#if request.status === "pending"}
                  <div class="flex flex-wrap justify-end gap-2">
                    <form method="POST" action="?/approve" use:enhance>
                      <input type="hidden" name="id" value={request.id} />
                      <button
                        type="submit"
                        class="rounded-md bg-primary px-3 py-1.5 text-caption font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        {m.admin_problemPublicationsApprove()}
                      </button>
                    </form>
                    <form
                      method="POST"
                      action="?/reject"
                      use:enhance
                      class="flex items-center gap-2"
                    >
                      <input type="hidden" name="id" value={request.id} />
                      <input
                        name="reviewNote"
                        class="w-44 rounded-md border border-border-subtle bg-background px-2 py-1.5 text-caption"
                        placeholder={m.admin_problemPublicationsRejectPrompt()}
                      />
                      <button
                        type="submit"
                        class="rounded-md border border-border px-3 py-1.5 text-caption font-medium text-muted-foreground hover:text-foreground"
                      >
                        {m.admin_problemPublicationsReject()}
                      </button>
                    </form>
                  </div>
                {:else if request.publishedProblemId}
                  <a
                    class="text-primary hover:underline"
                    href={`/problems/${request.publishedProblemId}`}
                  >
                    {m.admin_problemPublicationsViewProblem()}
                  </a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Card>
