<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import GithubMark from "./GithubMark.svelte";

  type Props = {
    repoUrl?: string;
  };

  let { repoUrl = "https://github.com/your-org/nojv" }: Props = $props();

  const year = new Date().getFullYear();
  let issuesUrl = $derived(`${repoUrl.replace(/\/$/, "")}/issues/new`);
</script>

<footer
  class="mt-16 flex flex-col gap-3 border-t border-border-subtle pt-5 pb-6 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
>
  <p class="tabular-nums">{m.footer_copyright({ year: String(year) })}</p>
  <nav class="flex flex-wrap items-center gap-x-6 gap-y-2">
    <a
      class="transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="/about">{m.footer_about()}</a
    >
    <a
      class="inline-flex items-center gap-1.5 transition-colors duration-fast ease-out-soft hover:text-foreground"
      href={repoUrl}
      target="_blank"
      rel="noreferrer noopener"
    >
      <GithubMark class="size-3.5" />
      {m.footer_projectGithub()}
    </a>
    <a
      class="transition-colors duration-fast ease-out-soft hover:text-foreground"
      href={issuesUrl}
      target="_blank"
      rel="noreferrer noopener">{m.footer_contact()}</a
    >
    <a
      class="transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="/legal/privacy">{m.footer_privacy()}</a
    >
    <a
      class="transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="/legal/terms">{m.footer_terms()}</a
    >
  </nav>
</footer>
