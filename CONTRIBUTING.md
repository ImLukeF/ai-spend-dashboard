# Contributing

Use Node 24 and `npm ci`. Work on a feature branch and open a pull request; the maintainer reviews and merges. Use Conventional Commits. DCO sign-off is not required.

Run `npm run check` (Biome, strict TypeScript, workerd/D1 tests, Vite build, secret scan). CI also bundles the Worker with `wrangler deploy --dry-run`; it never deploys and uses no account credentials. npm's legacy peer resolution is enabled because npm 10's peer resolver crashed on this tool combination. The lockfile is authoritative.

## Local smoke

Copy `.dev.vars.example` to ignored `.dev.vars`, generate a random login token, and leave provider keys empty. Run `npm run cf-typegen` after changing local bindings; remove `.dev.vars` and regenerate before committing binding types. Run `npm run seed:local` for **synthetic demo data**, then `npm run dev`. Only `127.0.0.1` is permitted for local servers.

Open `http://127.0.0.1:8787`, sign in and visit every navigation page. Exercise Explore ranges, grouping, filters and CSV; check mobile width, light/dark mode, keyboard controls, chart data tables and reduced motion. Inspect the browser console for script/CSP errors. Empty budgets and activity are expected with default config. For populated budgets, use a synthetic example config; never use production credentials. Trigger a local cron:

```sh
curl 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*'
```

Stop dev servers and browser resources you start. `dev:web` is a frontend-only server on loopback with an API proxy to the Worker.

## Tests and fixtures

Use committed fixtures and injected `Deps.fetch`, `now`, `randomId`, `sleep` and `log`. Global fetch throws `LiveNetworkBlocked`. No live credentials or network calls. Extend an existing contract proof before adding another layer. No tests asserting source wording.

To sanitise a response into a fixture: replace **every** ID, name, date, address, URL, credential and amount with synthetic values; remove key hints and unrelated metadata. Record the official source and date in `test/fixtures/README.md`. Review the entire file before committing. Never attach raw responses to public issues. Use fake keys like `test-provider-key-not-real` without real key prefixes.

## Adding a provider

1. Add a narrow adapter under `src/worker/providers` and zod schemas for every used endpoint. Keep I/O out of mapping functions.
2. Define normalised metrics, currency units, paging completeness and coverage gaps. Provider credentials go only to a fixed HTTPS origin; never follow redirects.
3. Add synthetic fixtures and contract tests for pagination, revisions, units, errors and drift.
4. Register the adapter and secret, extend config validation, update the README status table and provider docs.
5. Keep enforcement reversible, explicit, independently tested and dry-run by default. Add no delete/archive/admin-key operations.

## Migrations and money

Never edit a released migration. Append a version to `src/worker/db/migrations.ts`, with plain statements and no triggers or semicolons inside string literals. Test a fresh DB, repeat execution and migration races. Do not add another migration system or use `wrangler d1 migrations`.

Money is safe integer micro-USD. Preserve exact decimal parsing and allocation sums. Snapshot replacement must upsert and delete within one transaction, write unchanged facts zero times, and leave the previous snapshot intact if pagination fails.

## Pull requests

Describe user-visible behaviour, focused verification, limits and any plan deviation. Keep changes scoped, never commit secrets or private data, and run `npm run check:secrets`. A PR is not permission to deploy; maintainers release from reviewed commits.
