<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import GithubMark from "./GithubMark.svelte";

  type Props = {
    repoUrl?: string;
    contactEmail?: string;
  };

  let { repoUrl = "https://github.com/your-org/nojv", contactEmail = "contact@example.com" }: Props =
    $props();

  const year = new Date().getFullYear();
  let issuesUrl = $derived(`${repoUrl.replace(/\/$/, "")}/issues/new`);
</script>

<footer
  class="mt-16 border-t border-border pt-10 pb-6 text-body-sm text-muted-foreground"
>
  <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
    <div class="space-y-3">
      <a
        class="inline-flex text-title-sm font-bold tracking-tight text-foreground transition-colors duration-fast ease-out-soft hover:text-primary"
        href="/"
      >
        NOJV
      </a>
      <p class="text-body-sm leading-relaxed">{m.footer_tagline()}</p>
    </div>

    <div class="space-y-3">
      <h3 class="text-caption font-semibold uppercase tracking-[0.24em] text-foreground">
        {m.footer_product()}
      </h3>
      <ul class="space-y-2">
        <li>
          <a
            class="transition-colors duration-fast ease-out-soft hover:text-foreground"
            href="/about">{m.footer_about()}</a
          >
        </li>
        <li>
          <span class="cursor-not-allowed opacity-60" aria-disabled="true">{m.footer_docs()}</span>
        </li>
        <li>
          <span class="cursor-not-allowed opacity-60" aria-disabled="true">{m.footer_api()}</span>
        </li>
        <li>
          <span class="cursor-not-allowed opacity-60" aria-disabled="true">{m.footer_status()}</span>
        </li>
      </ul>
    </div>

    <div class="space-y-3">
      <h3 class="text-caption font-semibold uppercase tracking-[0.24em] text-foreground">
        {m.footer_community()}
      </h3>
      <ul class="space-y-2">
        <li>
          <a
            class="inline-flex items-center gap-1.5 transition-colors duration-fast ease-out-soft hover:text-foreground"
            href={repoUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <GithubMark class="size-3.5" />
            {m.footer_projectGithub()}
          </a>
        </li>
        <li>
          <a
            class="transition-colors duration-fast ease-out-soft hover:text-foreground"
            href={issuesUrl}
            target="_blank"
            rel="noreferrer noopener">{m.footer_openIssue()}</a
          >
        </li>
        <li>
          <a
            class="transition-colors duration-fast ease-out-soft hover:text-foreground"
            href={`mailto:${contactEmail}`}>{m.footer_contact()}</a
          >
        </li>
      </ul>
    </div>

    <div class="space-y-3">
      <h3 class="text-caption font-semibold uppercase tracking-[0.24em] text-foreground">
        {m.footer_legal()}
      </h3>
      <ul class="space-y-2">
        <li>
          <a
            class="transition-colors duration-fast ease-out-soft hover:text-foreground"
            href="/legal/terms">{m.footer_terms()}</a
          >
        </li>
        <li>
          <a
            class="transition-colors duration-fast ease-out-soft hover:text-foreground"
            href="/legal/privacy">{m.footer_privacy()}</a
          >
        </li>
      </ul>
    </div>
  </div>

  <div
    class="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border-subtle pt-5 text-caption sm:flex-row sm:items-center"
  >
    <p class="tabular-nums">{m.footer_copyright({ year: String(year) })}</p>
    <a
      class="inline-flex items-center gap-1.5 transition-colors duration-fast ease-out-soft hover:text-foreground"
      href={repoUrl}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={m.footer_projectGithub()}
    >
      <GithubMark class="size-4" />
    </a>
  </div>
</footer>
