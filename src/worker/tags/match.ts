import type { Config, ProviderId } from "../../shared/config-schema";
export function glob(pattern: string, value: string) {
  return new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  ).test(value);
}
export interface TagEntity {
  provider: ProviderId;
  workspaceId: string;
  apiKeyId: string;
  workspaceName: string;
  apiKeyName: string;
}
export function matchTags(config: Config, t: TagEntity) {
  const result: Record<string, string> = {};
  for (const dim of config.tags) {
    const rule = dim.rules.find(
      ({ match: m }) =>
        (!m.provider || m.provider === t.provider) &&
        (!m.workspaceIds?.length || m.workspaceIds.includes(t.workspaceId)) &&
        (!m.apiKeyIds?.length || m.apiKeyIds.includes(t.apiKeyId)) &&
        (!m.workspaceName || glob(m.workspaceName, t.workspaceName)) &&
        (!m.apiKeyName || glob(m.apiKeyName, t.apiKeyName)),
    );
    if (rule) result[dim.dimension] = rule.value;
  }
  return result;
}
