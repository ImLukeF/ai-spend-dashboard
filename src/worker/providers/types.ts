import type { ProviderId } from "../../shared/config-schema";
import type { Deps } from "../deps";
import type { BudgetCounter } from "../jobs/budget";

export type { ProviderId };
export type Metric =
  | "input_uncached"
  | "input_cache_read"
  | "input_cache_write_5m"
  | "input_cache_write_1h"
  | "input_cache_write"
  | "output"
  | "requests"
  | "web_search_requests"
  | "code_execution"
  | "session_usage"
  | "total"
  | "other";
export interface UsageRow {
  provider: ProviderId;
  bucket: string;
  workspaceId: string;
  apiKeyId: string;
  model: string;
  serviceTier: string;
  metric: Metric;
  quantity: number;
}
export interface CostRow {
  provider: ProviderId;
  day: string;
  workspaceId: string;
  apiKeyId: string;
  model: string;
  serviceTier: string;
  metric: Metric;
  lineItem: string;
  amountMicros: number;
  quantity: number | null;
}
export interface EntityRow {
  provider: ProviderId;
  kind: "api_key" | "workspace";
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  meta?: Record<string, unknown>;
}
export interface PullWindow {
  start: string;
  end: string | null;
}
export interface JobCtx {
  deps: Deps;
  budget: BudgetCounter;
  secret: string;
  entities?: EntityRow[];
  usage?: UsageRow[];
}
export interface ProviderAdapter {
  id: ProviderId;
  secretName: string;
  pullUsageHourly?: (ctx: JobCtx, w: PullWindow) => Promise<UsageRow[]>;
  pullUsageDaily?: (ctx: JobCtx, w: PullWindow) => Promise<UsageRow[]>;
  pullCostDaily: (ctx: JobCtx, w: PullWindow) => Promise<CostRow[]>;
  pullEntities: (
    ctx: JobCtx,
    cursor: string | null,
  ) => Promise<{ rows: EntityRow[]; cursor: string | null; complete: boolean }>;
}
