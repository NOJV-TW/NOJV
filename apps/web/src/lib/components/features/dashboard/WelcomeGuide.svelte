<script lang="ts">
  import { Rocket } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";

  interface Props {
    username?: string;
    platformRole?: string;
  }

  let { username, platformRole }: Props = $props();

  const isStaff = $derived(platformRole === "teacher" || platformRole === "admin");

  const title = $derived(
    username
      ? m.dashboard_welcomeGuideTitle({ username })
      : m.dashboard_welcomeGuideTitleAnon(),
  );

  const description = $derived(
    isStaff
      ? m.dashboard_welcomeGuideDescriptionStaff()
      : m.dashboard_welcomeGuideDescriptionStudent(),
  );

  const actions = $derived(
    isStaff
      ? [
          {
            href: "/courses/new",
            label: m.dashboard_welcomeGuideCreateCourse(),
            variant: "default" as const,
          },
          {
            href: "/problems",
            label: m.dashboard_welcomeGuideBrowseProblems(),
            variant: "outline" as const,
          },
        ]
      : [
          {
            href: "/problems",
            label: m.dashboard_welcomeGuideBrowseProblems(),
            variant: "default" as const,
          },
          {
            href: "/courses",
            label: m.dashboard_welcomeGuideBrowseCourses(),
            variant: "outline" as const,
          },
        ],
  );
</script>

<Card variant="surface" size="lg" data-tour="welcome-guide">
  <EmptyState variant="onboarding" icon={Rocket} {title} {description} {actions} />
</Card>
