# Deployment

Fork the repository using the README's Deploy to Cloudflare button. Workers Builds runs the npm build/deploy scripts. D1 automatic provisioning uses the binding name `DB`; do not commit a database ID or account ID. The Worker applies its versioned schema on first authenticated API use and every scheduled invocation. No separate migration command is needed.

Set `DASHBOARD_TOKEN` and the provider keys you use as Worker secrets. In the Deploy UI enter `-` for unused secrets (blank-value support is UNVERIFIED). Defaults are inert without credentials. The Setup page means auth has not been configured. Provider secrets are not required to view an empty dashboard.

For manual deployment from a reviewed, committed checkout:

```sh
npm ci
npm run check
npx wrangler secret put DASHBOARD_TOKEN
# Set only the provider/channel secrets you need, each with secret put.
npm run deploy
```

Wrangler may write resource IDs into your private deployment checkout. Keep them out of public commits. Review your diff before every push. `npx wrangler deploy --dry-run --outdir dist/worker` only bundles locally and does not require credentials.

## Access and custom domains

1. Attach a custom domain in the Cloudflare Worker dashboard; verify DNS and TLS there.
2. In Zero Trust, create a self-hosted Access application for that complete hostname and paths. Create an allow policy limited to your intended viewers.
3. Set `ACCESS_TEAM_DOMAIN` to the HTTPS team origin and `ACCESS_AUD` to the application audience as Worker secrets. Set `ALLOWED_EMAILS` and optionally `ADMIN_EMAILS` as secret comma lists.
4. Change `auth.mode` to `access`, commit and deploy your fork. Confirm allowed, denied and service-token requests using [auth semantics](auth.md).
5. Disable or protect alternate routes such as the Worker development hostname in your own account. The Worker independently checks JWTs even if a route bypasses the Access front door.

This project's build never changes Cloudflare or GitHub settings. The maintainer/operator performs account setup. Tokens, audiences and resource IDs belong in secrets/private operator records, never public config.

## Upgrades

Review the changelog and migrations; back up D1 using your account's export or Time Travel tools. Deploy a reviewed commit, check `/api/v1/status`, schema version, first tick, job health, alerts and dry-run actions. Migrations are forward-only; rollback of code does not reverse schema changes. Free CPU suitability is UNVERIFIED: use Workers Paid and set `runtime.plan: 'paid'` if ticks exceed CPU limits.

Optional Cloudflare email uses a `send_email` binding named `EMAIL`; see [alerts](alerts.md). No deployment was performed during the v1 build.
