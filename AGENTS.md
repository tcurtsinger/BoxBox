<!-- serenitynow:start -->
## SerenityNow memory

This project uses SerenityNow (an MCP server) as its persistent memory. Use it proactively, without being asked:

- **Start of a task:** recall prior context with `serenity_vault` action `build_context` (pass `query` with the task, or `path` to a key note), and `pack_context` to pull the most relevant notes + code under a token budget.
- **When a decision, constraint, or insight is set:** capture it via `serenity_note`. Write observations as `- [decision] ...` / `- [constraint] ...` lines and typed relations as `- relates_to [[Other Note]]`.
- **Model decisions as ADRs, not plain notes:** a decision or hard constraint is a note with `type: adr` and a `status` (proposed / accepted / superseded) — SerenityNow files it under `projects/<slug>/adr/`. Reference and how-to notes stay `type: note`. Pass `type`/`status`/`title` straight to `create_note`.
- **Before assuming something is not recorded:** search with `serenity_vault` action `search_vault` (mode `fts`) or `hybrid_search`.

Treat SerenityNow as the source of truth for this project's memory.
<!-- serenitynow:end -->
