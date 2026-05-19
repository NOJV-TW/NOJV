<script lang="ts">
  import { Rocket } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  interface Props {
    username?: string;
  }

  let { username }: Props = $props();

  const title = $derived(
    username
      ? m.dashboard_welcomeGuideTitle({ username })
      : m.dashboard_welcomeGuideTitleAnon()
  );
</script>

<Card variant="surface" size="lg">
  <EmptyState
    variant="onboarding"
    icon={Rocket}
    {title}
    description={m.dashboard_welcomeGuideDescription()}
    actions={[
      {
        href: "/problems",
        label: m.dashboard_welcomeGuideBrowseProblems(),
        variant: "default",
      },
      {
        href: "/courses",
        label: m.dashboard_welcomeGuideBrowseCourses(),
        variant: "outline",
      },
    ]}
  />
</Card>
