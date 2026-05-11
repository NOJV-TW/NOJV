<script lang="ts">
  import { Mail } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import PublicHeader from "$lib/components/layout/PublicHeader.svelte";
  import Footer from "$lib/components/layout/Footer.svelte";

  const contactEmail = "contact@example.com";
</script>

<svelte:head>
  <title>{m.legal_termsTitle()} · NOJV</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
  <PublicHeader />

  <main class="flex-1 pt-10">
    <h1 class="text-display font-bold leading-tight text-foreground">{m.legal_termsTitle()}</h1>
    <Card variant="surface" size="lg" class="mt-8">
      <p class="text-body-lg text-muted-foreground">{m.legal_comingSoon()}</p>
      <div class="mt-5">
        <Button href={`mailto:${contactEmail}`} variant="outline">
          <Mail class="size-4" />
          {m.about_emailUs()}
        </Button>
      </div>
    </Card>
  </main>

  <Footer {contactEmail} />
</div>
