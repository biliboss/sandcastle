Use `npm run typecheck` for type checking.

Check [./CONTEXT.md](./CONTEXT.md) for terminology questions.

For user-facing changes, add a changeset to `.changeset`. Check all changesets there first to see if there are duplicates. We use `@changesets/cli`, but you can create/edit the file manually. Make all changesets `patch` (since we're pre-1.0). Use `package.json#name` for the name.

When changing public-facing behavior, check `README.md` to see if the documentation needs updating.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `mattpocock/sandcastle`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels. Agent provider support is detailed here. See `docs/agents/triage.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Coordinator subsystem

`src/coordinator/` — multi-repo orchestration on top of Sandcastle. Polls a GitHub Project (v2), dispatches Claude Code agents per item, opens PRs. Separate concern from Sandcastle core; edit independently.

### gh api graphql flags

`-F` auto-types JS numbers/booleans (preserves `Int!`/`Boolean!` params). `-f` forces string (preserves all-digit IDs like ProjectV2 option IDs). Mixing wrong → `Variable $x of type Int! was provided invalid value` or `String! got Int`. See `ghFetchGraphQL.ts`.

### Container git constraints

Coordinator bind-mounts a working tree into the agent container. Two traps:

- `git worktree add` — `.git` is a file pointing outside the mount, unresolvable inside. Use standalone `git clone`.
- `git clone --shared` — writes alternates pointing at host paths invisible to container. Plain `git clone` only (hardlinks within same FS, self-contained).

### dockerRun.ts bypasses Sandcastle's docker provider

`src/coordinator/dockerRun.ts` shells out to `docker` directly. Reason: Sandcastle's provider races on `safe.directory` setup before container fully ready. Don't "fix" by reverting to provider.
