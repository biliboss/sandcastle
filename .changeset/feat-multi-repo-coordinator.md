---
"@ai-hero/sandcastle": patch
---

Add multi-repo coordinator layer (`@ai-hero/sandcastle/coordinator`). Drives `sandcastle.run()` across multiple repositories from a single GitHub Project (v2) board. Reads work items, claims them via atomic Status-field CAS, dispatches per-repo runs, writes session paths and status transitions back to the project. Uses the `gh` CLI for GraphQL — no new dependencies.
