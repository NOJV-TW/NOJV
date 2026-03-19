<script lang="ts">
  interface Violation {
    id: string;
    userId: string;
    user: { name: string; displayUsername: string | null; email: string };
    expectedIp: string | null;
    actualIp: string;
    violationType: string;
    createdAt: string;
  }

  interface Props {
    contestId?: string;
    assessmentId?: string;
  }

  let { contestId, assessmentId }: Props = $props();
  let violations: Violation[] = $state([]);
  let loading = $state(false);
  let loaded = $state(false);

  async function loadViolations() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (contestId) params.set("contestId", contestId);
      if (assessmentId) params.set("assessmentId", assessmentId);
      const res = await fetch(`/api/ip-violations?${params}`);
      if (res.ok) {
        const data = await res.json();
        violations = data.violations;
      }
    } finally {
      loading = false;
      loaded = true;
    }
  }
</script>

{#if !loaded}
  <button
    class="rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5"
    disabled={loading}
    onclick={loadViolations}
  >
    {loading ? "Loading..." : "Show IP Violation Log"}
  </button>
{:else if violations.length === 0}
  <p class="text-sm text-muted-foreground">No IP violations recorded.</p>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-border text-left text-xs text-muted-foreground">
          <th class="pb-2 pr-4">Student</th>
          <th class="pb-2 pr-4">Type</th>
          <th class="pb-2 pr-4">Expected IP</th>
          <th class="pb-2 pr-4">Actual IP</th>
          <th class="pb-2">Time</th>
        </tr>
      </thead>
      <tbody>
        {#each violations as v (v.id)}
          <tr class="border-b border-border/50">
            <td class="py-2 pr-4">{v.user.displayUsername ?? v.user.name}</td>
            <td class="py-2 pr-4">
              <span class="rounded-full border border-border px-2 py-0.5 text-xs">
                {v.violationType}
              </span>
            </td>
            <td class="py-2 pr-4 font-mono text-xs">{v.expectedIp ?? "—"}</td>
            <td class="py-2 pr-4 font-mono text-xs">{v.actualIp}</td>
            <td class="py-2 text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
