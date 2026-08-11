# GKE Judge Capacity Alignment Plan

**Goal:** Let the existing judge workers dispatch every sandbox slot that the GKE quota and autoscaling node pools can execute, without adding a second autoscaler for the non-bottleneck dispatcher.

**Architecture:** Keep two always-ready judge workers for availability. Raise each worker's activity concurrency from four to five, matching the GKE sandbox quota of ten Pods. Sandbox Jobs continue to trigger the existing on-demand plus Spot node-pool autoscaling; single-machine limits remain unchanged.

## Tasks

1. Add a focused infrastructure test that locks the GKE capacity relationship: two judge replicas, concurrency five, ten sandbox Pods, ten requested CPU, and four Spot burst nodes.
2. Set the GKE judge concurrency to five.
3. Update deployment guidance to distinguish dispatcher capacity from sandbox execution autoscaling and record the resulting ceilings.
4. Render both single-machine and GKE Helm manifests, then run the focused infrastructure suite and `pnpm ci:verify`.

## Acceptance

- GKE can dispatch ten light sandbox Jobs or five full 20-case Jobs without a worker slot becoming the first bottleneck.
- GKE keeps one on-demand sandbox node and scales up to four Spot sandbox nodes.
- Single-machine remains bounded at four Pods / four CPU / 12 GiB and one judge worker at concurrency four.
- No KEDA dependency, application queue, workflow, sandbox isolation, or public API change is introduced.
