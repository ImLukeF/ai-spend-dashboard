import type { Action, Config, ProviderId } from "../../shared/config-schema";
export type Mode = "off" | "dry_run" | "live";
export function mode(value: string): Mode {
  return value === "off" ? "off" : value === "live" ? "live" : "dry_run";
}
export function target(action: Action) {
  switch (action.type) {
    case "anthropic.deactivate_api_key":
      return action.apiKeyId;
    case "anthropic.deactivate_workspace_keys":
      return action.workspaceId;
    case "openai.set_project_spend_limit":
      return action.projectId;
    case "openrouter.disable_key":
      return action.keyHash;
  }
}
export function provider(action: Action) {
  return action.type.split(".")[0] as ProviderId;
}
export function guard(
  config: Config,
  id: string,
  lastSeen: string | null,
  lastSuccess: string | null,
  now: Date,
  fxOk: boolean,
) {
  if (config.enforcement.protectedKeyIds.includes(id)) return "protected";
  if (!lastSeen || now.getTime() - Date.parse(lastSeen) > 48 * 3600000)
    return "unknown_or_stale_target";
  if (!fxOk) return "missing_fx";
  if (!lastSuccess || now.getTime() - Date.parse(lastSuccess) > 2 * 3600000) return "stale_data";
  return null;
}
export function canRestore(current: unknown, applied: unknown) {
  return JSON.stringify(current) === JSON.stringify(applied);
}
