<script lang="ts">
  import Mail from "@lucide/svelte/icons/mail";
  import { m } from "$lib/paraglide/messages.js";
  import GithubMark from "./GithubMark.svelte";
  import DiscordMark from "./DiscordMark.svelte";

  type Props = {
    repoUrl?: string;
    contactEmail?: string;
  };

  let {
    repoUrl = "https://github.com/NOJV-TW/NOJV",
    contactEmail = "nojv.tw@gmail.com",
  }: Props = $props();

  const year = new Date().getFullYear();
</script>

<footer
  class="mt-16 flex flex-col gap-3 border-t border-border-subtle pt-3 pb-3 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
>
  <p class="tabular-nums">{m.footer_copyright({ year: String(year) })}</p>
  <nav class="flex flex-wrap items-center gap-x-6 gap-y-2">
    <a class="transition-colors duration-fast ease-out-soft hover:text-foreground" href="/about"
      >{m.footer_about()}</a
    >
    <a
      class="transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="/environment">{m.footer_environment()}</a
    >
    <a class="transition-colors duration-fast ease-out-soft hover:text-foreground" href="/docs"
      >{m.footer_apiDocs()}</a
    >
    <a
      class="inline-flex items-center gap-1.5 transition-colors duration-fast ease-out-soft hover:text-foreground"
      href={`mailto:${contactEmail}`}
    >
      <Mail aria-hidden="true" class="size-3.5" />
      {m.footer_contact()}
    </a>
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
      class="inline-flex items-center gap-1.5 transition-colors duration-fast ease-out-soft hover:text-foreground"
      href="https://discord.gg/69JkbePMSM"
      target="_blank"
      rel="noreferrer noopener"
    >
      <DiscordMark class="size-3.5" />
      {m.footer_discord()}
    </a>
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
