<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
</script>

<svelte:head>
  <title>{m.guideAdvanced_title()} · NOJV</title>
  <meta name="description" content={m.guideAdvanced_metaDescription()} />
</svelte:head>

<div class="mx-auto max-w-4xl space-y-8">
  <section class="space-y-3">
    <h1 class="text-title-xl font-bold">{m.guideAdvanced_title()}</h1>
    <p class="text-body-lg text-muted-foreground">
      {m.guideAdvanced_intro()}
    </p>
  </section>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">{m.guideAdvanced_workflowTitle()}</h2>
    <ol class="list-decimal space-y-2 pl-5 text-body-sm text-muted-foreground">
      <li>{m.guideAdvanced_workflowStep1()}</li>
      <li>{m.guideAdvanced_workflowStep2()}</li>
      <li>{m.guideAdvanced_workflowStep3()}</li>
      <li>{m.guideAdvanced_workflowStep4()}</li>
      <li>{m.guideAdvanced_workflowStep5()}</li>
    </ol>
    <pre
      class="overflow-auto rounded bg-black/85 p-4 text-caption text-white">{`docker build -t ghcr.io/your-org/my-problem-run:v1 ./run
docker push ghcr.io/your-org/my-problem-run:v1
# the push prints the digest; or resolve it explicitly:
docker buildx imagetools inspect ghcr.io/your-org/my-problem-run:v1
# paste the pinned form into the problem editor:
# ghcr.io/your-org/my-problem-run@sha256:<64 hex chars>`}</pre>
    <p class="text-body-sm text-muted-foreground">{m.guideAdvanced_digestNote()}</p>
  </Card>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">{m.guideAdvanced_contractTitle()}</h2>
    <pre
      class="overflow-auto rounded bg-black/85 p-4 text-caption text-white">{`run container (untrusted — the only place student code executes)
  /workspace/submission/   student files (read-only for you to consume)
  /workspace/meta.json     { submissionId, language, submissionFiles, resourceLimits }
  /workspace/output/       write per-case outputs here (binary OK)

grade container (trusted — answers live here, no student code)
  /workspace/run-output/   the run phase's output, mounted READ-ONLY
  /workspace/meta.json     { submissionId, language, runStatus }
  /workspace/output/result.json   write the final verdict here
  /answers/                your baked-in answers`}</pre>
    <ul class="list-disc space-y-2 pl-5 text-body-sm text-muted-foreground">
      <li>{m.guideAdvanced_runtimeItem1()}</li>
      <li>{m.guideAdvanced_runtimeItem2()}</li>
      <li>{m.guideAdvanced_runtimeItem3()}</li>
      <li>{m.guideAdvanced_runtimeItem4()}</li>
      <li>{m.guideAdvanced_runtimeItem5()}</li>
      <li>{m.guideAdvanced_runtimeItem6()}</li>
    </ul>
  </Card>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">{m.guideAdvanced_networkTitle()}</h2>
    <ul class="list-disc space-y-2 pl-5 text-body-sm text-muted-foreground">
      <li>{m.guideAdvanced_networkItem1()}</li>
      <li>{m.guideAdvanced_networkItem2()}</li>
      <li>{m.guideAdvanced_networkItem3()}</li>
      <li>{m.guideAdvanced_networkItem4()}</li>
    </ul>
  </Card>

  <Card variant="surface" size="lg" class="space-y-3">
    <h2 class="text-title-md font-semibold">result.json</h2>
    <pre class="overflow-auto rounded bg-black/85 p-4 text-caption text-white">{`{
  "verdict": "wrong_answer",
  "score": 120,
  "feedback": "Passed 6 of 10 rubric checks"
}`}</pre>
    <p class="text-body-sm text-muted-foreground">
      {m.guideAdvanced_resultNote()}
    </p>
  </Card>
</div>
