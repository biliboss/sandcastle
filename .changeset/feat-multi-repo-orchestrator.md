---
"@ai-hero/sandcastle": patch
---

Add multi-repo orchestrator layer (`@ai-hero/sandcastle/orchestrator`). Drives `sandcastle.run()` across multiple repositories from a single GitHub Project (v2) board. Reads work items, dispatches per-repo runs in parallel, writes results (PR links, session paths) back to the project. Uses `gh` CLI for GraphQL — no new dependencies.
