<script lang="ts">
  import { t } from "svelte-i18n";
  import SchoolVerificationSection from "$lib/components/auth/SchoolVerification.svelte";

  let { data } = $props();
</script>

<div class="space-y-6">
  <h2 class="font-[family-name:var(--font-display)] text-3xl">{$t("navigation.account")}</h2>
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6"
  >
    <dl class="grid gap-4 sm:grid-cols-2">
      <div>
        <dt class="text-sm text-[color:var(--color-muted)]">{$t("account.name")}</dt>
        <dd class="mt-1 font-medium">{data.name}</dd>
      </div>
      <div>
        <dt class="text-sm text-[color:var(--color-muted)]">{$t("account.email")}</dt>
        <dd class="mt-1 font-medium">{data.email}</dd>
      </div>
      <div>
        <dt class="text-sm text-[color:var(--color-muted)]">{$t("account.userAccount")}</dt>
        <dd class="mt-1 flex items-center gap-1.5 font-medium">
          {data.handle}
          {#if data.isSchoolVerified}
            <svg
              class="size-4 text-green-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-label="School verified"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="text-sm text-[color:var(--color-muted)]">{$t("account.role")}</dt>
        <dd class="mt-1 font-medium">{data.platformRole}</dd>
      </div>
    </dl>
  </section>
  <SchoolVerificationSection isSchoolVerified={data.isSchoolVerified} />
</div>
