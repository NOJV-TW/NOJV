# Grafana Cloud cadence implementation plan

Goal: retain 30-second local monitoring while sending the same metrics to Cloud at 60-second intervals.

Architecture: reuse the pinned Prometheus image in Agent mode as an independent optional Deployment. Both processes share the scrape-job template, but only the agent has remote_write and credentials. Give its WAL a dedicated persistent volume and port. No new dependency or configurable cadence is needed.

1. Extend the Helm render test to check separate intervals, exactly one remote_write, matching targets, disabled-cloud behavior and checksum changes.
2. Split the scrape jobs into a shared helper, render independent local and agent configs, and add the conditional agent Deployment and WAL PVC.
3. Update the observability runbook, chart reference and OPS-14 decision.
4. Run Helm lint, infrastructure/document guards, test typechecking and promtool against both rendered configurations. Exercise both processes against a disposable metric source and receiver to verify sample cadence and restart recovery.
5. Create the PR, follow required CI/review gates, and deploy through the normal verified release path where authorized. Verify live local cadence, Cloud ingestion and remote-write failures before claiming deployment.
