# Drag-Reorder Problems Implementation Plan

**Goal:** Make every staff-facing problem-order editor use drag-and-drop, and make previews open through a route that preserves staff access to private problems.

**Architecture:** Keep the existing array payloads and server actions. Add one small generic array-reorder helper, use native HTML drag events in the four existing editing components, and route previews through the current assignment context or a manager-only exam preview branch.

**Tech Stack:** Svelte 5, SvelteKit, native HTML5 drag-and-drop, Vitest, svelte-check.

### Completed

- Added bounds-safe `moveItem` helper with forward, backward, and invalid-move tests.
- Replaced order arrows with native drag handles, drop feedback, and keyboard fallback in all staff-facing problem-order editors.
- Preserved existing ordered form payloads and add/remove/save flows.
- Fixed assignment preview URLs and added manager-only exam preview access without an exam session.
- Passed focused tests, full unit tests, web check, lint, build, and local browser smoke test.
