// UNVERIFIED: one-cent limits on already-over-budget projects; sandbox-test before live. https://developers.openai.com/api/docs/guides/spend-limits
import { z } from "zod";
import type { Budget } from "../../shared/config-schema";
import { iso, period } from "../../shared/periods";
import { emit } from "../alerts/events";
import { audit } from "../db/repo/state";
import type { Deps } from "../deps";
import { providerSecrets, secret } from "../env";
import type { BudgetCounter } from "../jobs/budget";
import { canonical } from "../lib/hash";
import { redact } from "../lib/redact";
import { listEntities } from "../providers/anthropic/client";
import { entity as anthropicEntity } from "../providers/anthropic/schemas";
import { providerFetch } from "../providers/http";
import { spendLimit } from "../providers/openai/schemas";
import { keySchema } from "../providers/openrouter/schemas";
import type { JobCtx, ProviderId } from "../providers/types";
import { guard, mode, provider, target } from "./plan";
export interface StoredAction {
  id: string;
  budget_id: string;
  period_start: string;
  action_type: string;
  provider: ProviderId;
  target_id: string;
  mode: string;
  status: string;
  previous_state: string | null;
  applied_state: string | null;
  created_at: string;
}
export async function state(ctx: JobCtx, type: string, id: string) {
  if (type.startsWith("anthropic.")) {
    const p = await providerFetch(
      ctx,
      "anthropic",
      `/v1/organizations/api_keys/${encodeURIComponent(id)}`,
      anthropicEntity,
    );
    return { status: p?.status ?? "" };
  }
  if (type.startsWith("openrouter.")) {
    const p = await providerFetch(
      ctx,
      "openrouter",
      `/api/v1/keys/${encodeURIComponent(id)}`,
      z.object({ data: keySchema }),
    );
    return { disabled: p?.data.disabled ?? true };
  }
  const p = await providerFetch(
    ctx,
    "openai",
    `/v1/organization/projects/${encodeURIComponent(id)}/spend_limit`,
    spendLimit,
    {},
    true,
  );
  return p
    ? {
        threshold_amount: p.threshold_amount,
        currency: p.currency,
        interval: p.interval,
        enforcement: p.enforcement.status,
      }
    : { none: true };
}
export function appliedState(type: string) {
  return type.startsWith("anthropic.")
    ? { status: "inactive" }
    : type.startsWith("openrouter.")
      ? { disabled: true }
      : { threshold_amount: 1, currency: "USD", interval: "month", enforcement: "enforcing" };
}
export async function writeState(
  ctx: JobCtx,
  type: string,
  id: string,
  value: Record<string, unknown>,
) {
  if (type.startsWith("anthropic.")) {
    if (value.status !== "active" && value.status !== "inactive")
      throw new Error("Unsafe key status");
    await providerFetch(
      ctx,
      "anthropic",
      `/v1/organizations/api_keys/${encodeURIComponent(id)}`,
      anthropicEntity,
      { method: "POST", body: JSON.stringify({ status: value.status }) },
    );
  } else if (type.startsWith("openrouter."))
    await providerFetch(
      ctx,
      "openrouter",
      `/api/v1/keys/${encodeURIComponent(id)}`,
      z.object({ data: keySchema }),
      { method: "PATCH", body: JSON.stringify({ disabled: value.disabled }) },
    );
  else {
    const path = `/v1/organization/projects/${encodeURIComponent(id)}/spend_limit`;
    if (value.none)
      await providerFetch(ctx, "openai", path, z.looseObject({ deleted: z.boolean() }), {
        method: "DELETE",
      });
    else
      await providerFetch(ctx, "openai", path, spendLimit, {
        method: "POST",
        body: JSON.stringify({
          threshold_amount: value.threshold_amount,
          currency: "USD",
          interval: "month",
        }),
      });
  }
}
export async function transition(
  deps: Deps,
  row: StoredAction,
  status: string,
  reason: string | null = null,
) {
  await deps.env.DB.prepare(
    "UPDATE enforcement_actions SET status=?,reason=?,updated_at=? WHERE id=?",
  )
    .bind(status, reason, iso(deps.now()), row.id)
    .run();
  const budget = deps.config.budgets.find((b) => b.id === row.budget_id);
  const type = `enforcement.${status}`;
  await emit(deps, {
    type,
    severity: ["failed", "restore_failed", "skipped"].includes(status) ? "critical" : "info",
    dedupeKey: `action:${row.id}:${status}`,
    budgetId: row.budget_id,
    periodStart: row.period_start,
    data: { targetId: row.target_id.slice(0, 4), reason, actionType: row.action_type },
    channels: budget?.channels ?? [],
  });
  await audit(
    deps.env.DB,
    iso(deps.now()),
    "cron",
    status.startsWith("restore") ? "restore" : "enforce",
    { actionId: row.id, status, reason },
  );
}
export async function executeEnforcement(
  deps: Deps,
  counter: BudgetCounter,
  evaluated: { budget: Budget; result: { percent: number; canEnforce: boolean; start: string } }[],
) {
  const master = mode(secret(deps.env, "ENFORCEMENT_MODE"));
  if (master === "off") return;
  let count = 0;
  const today = iso(deps.now()).slice(0, 10);
  let daily = Number(
    (await deps.env.DB.prepare(
      "SELECT count(*) n FROM enforcement_actions WHERE created_at>=? AND status NOT IN ('skipped','dry_run') AND mode='live'",
    )
      .bind(today)
      .first<number>("n")) ?? 0,
  );
  for (const { budget, result } of evaluated) {
    if (!budget.enforce || result.percent < budget.enforce.atPercent) continue;
    for (const action of budget.enforce.actions) {
      const p = provider(action);
      const ctx: JobCtx = { deps, budget: counter, secret: secret(deps.env, providerSecrets[p]) };
      let targets = [{ id: target(action), type: action.type }];
      let expansionReason: string | null = null;
      if (action.type === "anthropic.deactivate_workspace_keys") {
        if (ctx.secret) {
          if (!counter.fits(2, 8)) return;
          const keys = await listEntities(
            ctx,
            "api_key",
            `&workspace_id=${encodeURIComponent(action.workspaceId)}&status=active`,
          );
          if (keys.length > action.maxKeys) expansionReason = "workspace_max_keys";
          else targets = keys.map((k) => ({ id: k.id, type: "anthropic.deactivate_api_key" }));
        }
      }
      for (const t of targets) {
        if (!counter.fits(master === "live" ? 2 : 0, 8)) return;
        const id = deps.randomId();
        const entity = await deps.env.DB.prepare(
          "SELECT last_seen_at,status FROM entities WHERE provider=? AND id=? AND kind=?",
        )
          .bind(
            p,
            t.id,
            t.type === "openai.set_project_spend_limit" ||
              t.type === "anthropic.deactivate_workspace_keys"
              ? "workspace"
              : "api_key",
          )
          .first<{ last_seen_at: string; status: string }>();
        const sync = await deps.env.DB.prepare(
          "SELECT max(last_success_at) success FROM sync_state WHERE provider=? AND (job LIKE '%.cost_daily' OR job LIKE '%.usage_daily' OR job LIKE '%.usage_hourly')",
        )
          .bind(p)
          .first<string>("success");
        let reason = guard(
          deps.config,
          t.id,
          entity?.last_seen_at ?? null,
          sync,
          deps.now(),
          result.canEnforce,
        );
        if (expansionReason) reason = expansionReason;
        if (
          count >= deps.config.enforcement.maxActionsPerTick ||
          daily >= deps.config.enforcement.maxActionsPerDay
        )
          reason = "action_cap";
        if (!ctx.secret) reason = "provider_not_configured";
        const status = reason ? "skipped" : master === "dry_run" ? "dry_run" : "planned";
        const created = iso(deps.now());
        const inserted = await deps.env.DB.prepare(
          "INSERT OR IGNORE INTO enforcement_actions(id,budget_id,period_start,action_type,provider,target_id,mode,status,created_at,updated_at,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
          .bind(
            id,
            budget.id,
            result.start,
            t.type,
            p,
            t.id,
            master,
            status,
            created,
            created,
            reason,
          )
          .run();
        if (!inserted.meta.changes) continue;
        const row: StoredAction = {
          id,
          budget_id: budget.id,
          period_start: result.start,
          action_type: t.type,
          provider: p,
          target_id: t.id,
          mode: master,
          status,
          previous_state: null,
          applied_state: null,
          created_at: created,
        };
        if (status !== "planned") {
          await transition(deps, row, status, reason);
          continue;
        }
        count++;
        daily++;
        let snapshotTaken = false;
        try {
          const previous = await state(ctx, t.type, t.id);
          if (canonical(previous) === canonical(appliedState(t.type))) {
            await transition(deps, row, "skipped", "already_disabled");
            continue;
          }
          if ("status" in previous && previous.status !== "active") {
            await transition(deps, row, "skipped", "key_not_active");
            continue;
          }
          await deps.env.DB.prepare(
            "UPDATE enforcement_actions SET previous_state=?,applied_state=? WHERE id=?",
          )
            .bind(JSON.stringify(previous), JSON.stringify(appliedState(t.type)), id)
            .run();
          snapshotTaken = true;
          await writeState(ctx, t.type, t.id, appliedState(t.type));
          await transition(deps, row, "applied");
        } catch (e) {
          await deps.env.DB.prepare("UPDATE enforcement_actions SET error=? WHERE id=?")
            .bind(redact(e), id)
            .run();
          if (snapshotTaken) {
            // A transport failure may follow a successful provider mutation. Retain the
            // recoverable planned state until a later read can determine what happened.
            await emit(deps, {
              type: "enforcement.failed",
              severity: "critical",
              dedupeKey: `action:${id}:uncertain`,
              budgetId: budget.id,
              periodStart: result.start,
              data: { targetId: t.id.slice(0, 4), reason: "provider_state_uncertain" },
              channels: budget.channels,
            });
          } else await transition(deps, row, "failed", redact(e));
        }
      }
    }
  }
}
export async function restoreEnforcement(deps: Deps, counter: BudgetCounter) {
  if (mode(secret(deps.env, "ENFORCEMENT_MODE")) !== "live") return;
  const rows = await deps.env.DB.prepare(
    "SELECT * FROM enforcement_actions WHERE mode='live' AND status IN ('applied','restore_failed') ORDER BY created_at",
  ).all<StoredAction>();
  for (const row of rows.results) {
    const budget = deps.config.budgets.find((b) => b.id === row.budget_id);
    if (!budget?.enforce?.restoreAtPeriodEnd) continue;
    const end = period(new Date(row.period_start), budget.period).end;
    if (deps.now().getTime() < Date.parse(end) || deps.now().getTime() - Date.parse(end) > 86400000)
      continue;
    if (!counter.fits(2, 5)) break;
    if (deps.config.enforcement.protectedKeyIds.includes(row.target_id)) {
      await transition(deps, row, "overridden", "protected");
      continue;
    }
    const ctx: JobCtx = {
      deps,
      budget: counter,
      secret: secret(deps.env, providerSecrets[row.provider]),
    };
    try {
      const current = await state(ctx, row.action_type, row.target_id);
      if (canonical(current) !== canonical(JSON.parse(row.applied_state ?? "{}"))) {
        await transition(deps, row, "overridden", "provider_state_changed");
        continue;
      }
      await writeState(ctx, row.action_type, row.target_id, JSON.parse(row.previous_state ?? "{}"));
      await transition(deps, row, "restored");
    } catch (e) {
      await transition(deps, row, "restore_failed", redact(e));
    }
  }
}

export async function recoverPlanned(deps: Deps, counter: BudgetCounter) {
  if (mode(secret(deps.env, "ENFORCEMENT_MODE")) !== "live") return;
  const rows = await deps.env.DB.prepare(
    "SELECT * FROM enforcement_actions WHERE mode='live' AND status='planned'",
  ).all<StoredAction>();
  for (const row of rows.results) {
    if (!counter.fits(1, 4)) break;
    if (!row.previous_state || !row.applied_state) {
      await transition(deps, row, "failed", "interrupted_before_snapshot");
      continue;
    }
    const ctx: JobCtx = {
      deps,
      budget: counter,
      secret: secret(deps.env, providerSecrets[row.provider]),
    };
    try {
      const current = await state(ctx, row.action_type, row.target_id);
      const expected = JSON.parse(row.applied_state);
      const previous = JSON.parse(row.previous_state);
      if (canonical(current) === canonical(expected))
        await transition(deps, row, "applied", "reconciled_after_interruption");
      else if (canonical(current) === canonical(previous))
        await transition(deps, row, "failed", "interrupted_before_apply");
      else await transition(deps, row, "overridden", "provider_state_changed");
    } catch (e) {
      deps.log({ action: "reconcile", error: redact(e) });
    }
  }
}
