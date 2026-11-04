# AGENTS.md

Rules for everyone working on this repository, human or AI agent.

## Setup

- Node 24 (`.nvmrc`; Node 22.12+ is supported) and npm.
- Install with `npm ci`. The lockfile is authoritative.
- Run locally: `cp .dev.vars.example .dev.vars`, set a random `DASHBOARD_TOKEN` (32+ characters), then `npm run dev`.
- `npm run seed:local` loads synthetic demo data only.
- After changing bindings, remove `.dev.vars` and run `npm run cf-typegen` before committing `worker-configuration.d.ts`.

## Checks

- `npm run lint` (Biome)
- `npm run typecheck` (Wrangler types check and `tsc`)
- `npm test` (Vitest in workerd with local D1)
- `npm run build` (Vite)
- `npm run check:secrets` (scan of tracked files)
- `npm run check` runs all five. CI also runs `npx wrangler deploy --dry-run --outdir dist/worker`, which does not deploy.

## Workflow

- Work on a feature branch. Never push to `main`.
- Keep PRs small and focused on one change. Use Conventional Commits.
- All checks must pass before you open a PR.
- The maintainer reviews, merges and releases. Do not merge, approve or close PRs, and do not deploy.

## Secrets and personal data

- Never commit secrets, real API keys, tokens, account, org, project or key IDs, or personal data.
- Use placeholders: `example.com` addresses, `.dev.vars.example`, and fake keys such as `test-provider-key-not-real` with no real key prefix.
- Real values go only in the ignored `.dev.vars` or in Worker secrets. `wrangler.jsonc` contains no resource IDs.

## Tests

- Use committed fixtures in `test/fixtures` and injected dependencies.
- No live network calls and no credentials. Global fetch is blocked in tests.
- Fixtures are synthetic. Replace every ID, name, date, URL, amount and credential before committing one.

## Dependencies

- Keep dependencies minimal. Prefer the platform and existing packages, and explain any new dependency in the PR.

## Local servers

- Bind every local server to `127.0.0.1`. Never open public ports.

## Docs

- Do not invent statistics, user numbers, quotes, testimonials or other claims.
- Mark unconfirmed provider behaviour as **UNVERIFIED**.
