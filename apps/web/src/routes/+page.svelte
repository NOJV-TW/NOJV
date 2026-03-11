<script lang="ts">
  import { t } from "svelte-i18n";
</script>

<svelte:head>
  <title>NOJV</title>
  <meta name="description" content={$t("home.productDescription")} />
</svelte:head>

<section class="flex flex-col items-center gap-6 py-16 text-center">
  <span
    class="rounded-full border border-[color:var(--color-border)] bg-white/60 px-4 py-1.5 text-sm font-medium"
  >
    {$t("hero.eyebrow")}
  </span>
  <h1 class="font-[family-name:var(--font-display)] text-4xl font-bold sm:text-5xl">
    {$t("hero.title")}
  </h1>
  <p class="max-w-lg text-lg text-[color:var(--color-muted)]">
    {$t("hero.subtitle")}
  </p>
</section>
