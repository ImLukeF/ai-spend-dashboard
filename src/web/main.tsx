import { Chart, registerables } from "chart.js";
import { type ComponentChildren, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SpendRow } from "../shared/api-types";
import { valueAxis } from "./chart";
import { tagLabels } from "./format";
import "./style.css";

Chart.register(...registerables);
type Row = Partial<SpendRow> & {
  [key: string]: unknown;
  id?: string;
  name?: string;
  provider?: string;
  group?: string;
  label?: string;
  model?: string;
  apiKey?: string;
  day?: string;
  date?: string;
  bucket?: string;
  period_start?: string;
  time?: string;
  amount?: number;
  quantity?: number;
  spend?: number;
  spent?: number;
  value?: number;
  tokens?: number;
  requests?: number;
  basis?: string;
  basisMix?: Record<string, number>;
  currency?: string;
  limitCurrency?: string;
  percent?: number | null;
  limit?: number;
  forecast?: number;
  status?: string;
  period?: string;
  enforcement?: { mode?: string; pending?: number };
  title?: string;
  message?: string;
  description?: string;
  detail?: string;
  type?: string;
  action_type?: string;
  payload?: { message?: string; description?: string };
  deliveries?: Row[];
  channel?: string;
  channelId?: string;
  channel_id?: string;
  createdAt?: string;
  created_at?: string;
  at?: string;
  timestamp?: string;
  lastSuccessAt?: string;
  last_success_at?: string;
  lastError?: string;
  last_error?: string;
  lastUsedAt?: string;
  last_used_at?: string;
  lastUsed?: string;
  nextDueAt?: string;
  next_due_at?: string;
  rows?: number | Row[];
  last_rows?: number;
  workspaceName?: string;
  workspace?: string;
  projectName?: string;
  tags?: unknown;
  monthToDate?: number;
  mtdSpend?: number;
  duplicateName?: boolean;
  duplicate_name?: boolean;
  protected?: boolean;
  enabled?: boolean;
  configured?: boolean;
  hasData?: boolean;
  syntheticDemo?: boolean;
  job?: string;
  thresholdsHit?: unknown;
  thresholds_hit?: unknown;
  dimension?: string;
  display?: {
    currency?: string;
    extraCurrencies?: string[];
    tax?: { enabled?: boolean; label?: string };
  };
  authMode?: string;
  canAdmin?: boolean;
  totals?: Record<string, number | null>;
  budgets?: Row[];
  freshness?: Row[];
  generatedAt?: string;
  fx?: { source?: string; rate?: number; day?: string };
  unpricedTokens?: number;
  warnings?: (string | Row)[];
  results?: Row[];
  budget?: Row;
  history?: Row[];
  periods?: Row[];
  events?: Row[];
  actions?: Row[];
  configValid?: boolean;
  configErrors?: Row[];
  lastTick?: { at?: string };
  schemaVersion?: number;
  version?: string;
  error?: { message?: string; code?: string };
};
const API = "/api/v1";
const colors = [
  "#0072b2",
  "#e69f00",
  "#009e73",
  "#cc79a7",
  "#d55e00",
  "#56b4e9",
  "#f0e442",
  "#000000",
  "#888888",
];
const nav = [
  ["/", "Overview"],
  ["/explore", "Explore"],
  ["/budgets", "Budgets"],
  ["/keys", "Keys & workspaces"],
  ["/activity", "Activity"],
  ["/settings", "Settings & status"],
];
const rows = (value: unknown, ...keys: string[]): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return (keys.map((k) => object[k]).find(Array.isArray) as Row[] | undefined) || [];
};
const text = (value: unknown, fallback = "—") =>
  value === null || value === undefined || value === ""
    ? fallback
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
const date = (value: unknown) => (value ? new Date(String(value)).toLocaleString() : "—");
const short = (value: unknown) => {
  const s = text(value);
  return s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
};
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => ({}))) as Row;
  if (!response.ok) {
    const error = new Error(
      body.error?.message || `Request failed (${response.status})`,
    ) as Error & { status: number; code?: string };
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }
  return body;
}
function Basis({ basis }: { basis?: string }) {
  if (!basis || basis === "billed") return basis ? <span class="basis">billed</span> : null;
  return (
    <span
      class={`basis ${basis === "estimated" ? "estimated" : ""}`}
      title={
        basis === "allocated"
          ? "Allocated from billed provider costs based on usage."
          : "Estimated from available pricing."
      }
    >
      {basis === "allocated" ? "alloc." : basis === "estimated" ? "est." : basis}
    </span>
  );
}
function BasisMix({ row }: { row: Row }) {
  const mix = row.basisMix;
  if (!mix) return <Basis basis={row.basis} />;
  return (
    <>
      {(["billed", "allocated", "estimated"] as const)
        .filter((k) => Number(mix[k]) > 0)
        .map((k) => (
          <Basis basis={k} />
        ))}
    </>
  );
}
function Empty({ children = "No data for this period." }: { children?: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
function Tags({ value }: { value: unknown }) {
  const labels = tagLabels(value);
  return labels.length ? (
    <span class="tags">
      {labels.map((label) => (
        <span class="tag" key={label}>
          {label}
        </span>
      ))}
    </span>
  ) : (
    <>—</>
  );
}
function Table({ headings, children }: { headings: string[]; children: ComponentChildren }) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function ChartView({
  data,
  label,
  money,
  currency,
}: {
  data: unknown;
  label: string;
  money: (n: unknown) => string;
  currency?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const series = rows(data, "series", "data", "rows");
  useEffect(() => {
    if (!canvas.current || !series.length) return;
    const dates = [
      ...new Set(series.map((r) => text(r.day ?? r.date ?? r.bucket ?? r.period_start ?? r.time))),
    ];
    const groups = [
      ...new Set(series.map((r) => text(r.group ?? r.provider ?? r.name ?? r.label, "Total"))),
    ];
    const chart = new Chart(canvas.current, {
      type: "bar",
      data: {
        labels: dates,
        datasets: groups.map((group, i) => ({
          label: group,
          backgroundColor: colors[Math.min(i, 8)],
          data: dates.map((day) =>
            series
              .filter(
                (r) =>
                  text(r.day ?? r.date ?? r.bucket ?? r.period_start ?? r.time) === day &&
                  text(r.group ?? r.provider ?? r.name ?? r.label, "Total") === group,
              )
              .reduce(
                (sum, r) =>
                  sum +
                  Number(r.amount ?? r.quantity ?? r.spend ?? r.spent ?? r.value ?? r.tokens ?? 0),
                0,
              ),
          ),
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? false
          : { duration: 350 },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: valueAxis(currency),
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${money(context.parsed.y)}`,
            },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [data, currency]);
  if (!series.length) return <Empty />;
  return (
    <>
      <div class="chart">
        <canvas ref={canvas} role="img" aria-label={label} />
      </div>
      <details>
        <summary>View chart data</summary>
        <Table headings={["Date", "Group", currency ? `Spend (${currency})` : "Tokens", "Basis"]}>
          {series.map((r, i) => (
            <tr key={i}>
              <td>{text(r.day ?? r.date ?? r.bucket ?? r.period_start ?? r.time)}</td>
              <td>{text(r.group ?? r.provider ?? r.name ?? r.label, "Total")}</td>
              <td class={r.basis === "estimated" || r.basisMix?.estimated ? "estimated" : ""}>
                {money(r.amount ?? r.quantity ?? r.spend ?? r.spent ?? r.value ?? 0)}
              </td>
              <td>
                <BasisMix row={r} />
              </td>
            </tr>
          ))}
        </Table>
      </details>
    </>
  );
}
function App() {
  const [path, setPath] = useState(location.hash.slice(1) || "/");
  const [me, setMe] = useState<Row | null>(null);
  const [config, setConfig] = useState<Row>({});
  const [summary, setSummary] = useState<Row>({});
  const [currency, setCurrency] = useState("USD");
  const [tax, setTax] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Row>({});
  const [range, setRange] = useState("30");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState("provider");
  const [filter, setFilter] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [tag, setTag] = useState("");
  const [eventType, setEventType] = useState("");
  const money = (n: unknown, unit = "USD") =>
    n === null || n === undefined
      ? "—"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: unit }).format(
          Number(n) || 0,
        );
  const summaryMoney = (n: unknown) => money(n, summary.currency || "USD");
  const spendMoney = (index: number) => (n: unknown) => money(n, result[index]?.currency || "USD");
  const number = (n: unknown) =>
    n === null || n === undefined ? "—" : new Intl.NumberFormat().format(Number(n) || 0);
  useEffect(() => {
    const onHash = () => setPath(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const refresh = () => {
    setLoading(true);
    request("/me")
      .then(async (user) => {
        setMe(user);
        const [c, s] = await Promise.all([
          request("/config"),
          request(`/summary?currency=${currency}&tax=${tax ? 1 : 0}`),
        ]);
        setConfig(c);
        setSummary(s);
        setError("");
      })
      .catch((e) => {
        setMe(null);
        if (e.status === 401) location.hash = "#/login";
        else if (e.code === "config_invalid") location.hash = "#/config-invalid";
        else if (e.code === "auth_not_configured" || e.status === 503) location.hash = "#/setup";
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [currency, tax]);
  // Shared by the Explore view and its CSV export, so the file matches the screen.
  const spendQuery = `from=${from}&to=${to}&groupBy=${encodeURIComponent(group)}&currency=${currency}&tax=${tax ? 1 : 0}${filter ? `&provider=${encodeURIComponent(filter)}` : ""}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}${apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : ""}${model ? `&model=${encodeURIComponent(model)}` : ""}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`;
  useEffect(() => {
    if (!me) return;
    let active = true;
    const query = spendQuery;
    let calls: Promise<Row>[] = [];
    if (path === "/")
      calls = [
        request(
          `/spend?from=${daysAgo(29)}&to=${today()}&groupBy=provider&currency=${currency}&tax=${tax ? 1 : 0}`,
        ),
        request(
          `/spend?from=${today().slice(0, 8)}01&to=${today()}&groupBy=api_key&currency=${currency}&tax=${tax ? 1 : 0}`,
        ),
        request(
          `/spend?from=${today().slice(0, 8)}01&to=${today()}&groupBy=model&currency=${currency}&tax=${tax ? 1 : 0}`,
        ),
      ];
    else if (path === "/explore")
      calls = [
        request(`/spend?${query}`),
        request(
          `/usage?from=${from}&to=${to}&granularity=${range === "24h" ? "hour" : "day"}&metric=tokens&groupBy=${encodeURIComponent(group)}${filter ? `&provider=${encodeURIComponent(filter)}` : ""}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ""}${apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : ""}${model ? `&model=${encodeURIComponent(model)}` : ""}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`,
        ),
      ];
    else if (path.startsWith("/budgets"))
      calls = [
        request(
          path === "/budgets"
            ? "/budgets"
            : `/budgets/${encodeURIComponent(path.split("/")[2] || "")}`,
        ),
      ];
    else if (path === "/keys") calls = [request("/entities")];
    else if (path === "/activity")
      calls = [
        request(`/events?limit=50${eventType ? `&type=${encodeURIComponent(eventType)}` : ""}`),
      ];
    else if (path === "/settings") calls = [request("/status")];
    if (calls.length)
      Promise.all(calls)
        .then((results) => {
          if (active) {
            setData({ results });
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [
    me,
    path,
    from,
    to,
    group,
    filter,
    workspace,
    apiKey,
    model,
    tag,
    currency,
    tax,
    eventType,
    range,
  ]);
  const result = data.results || [];
  const budgets = rows(path === "/" ? summary.budgets : result[0], "budgets", "items", "data");
  const freshness = rows(summary.freshness);
  const worstAge = freshness.length
    ? Math.max(
        ...freshness.map((r) =>
          r.lastSuccessAt ? Date.now() - new Date(r.lastSuccessAt).getTime() : Infinity,
        ),
      )
    : Infinity;
  const freshnessLevel =
    worstAge <= 45 * 60_000 ? "fresh" : worstAge < 3 * 60 * 60_000 ? "stale" : "old";
  const currencies = [
    ...new Set(
      [
        "USD",
        config.display?.currency,
        ...(config.display?.extraCurrencies || []),
        summary.currency,
      ].filter(Boolean),
    ),
  ] as string[];
  const action = async (endpoint: string, body?: Row) => {
    try {
      await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-asd-csrf": "1" },
        body: JSON.stringify(body || {}),
      });
      setNotice(endpoint.includes("sync") ? "Sync requested." : "Test alert requested.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setPreset = (value: string) => {
    setRange(value);
    const now = today();
    setTo(now);
    if (value === "mtd") setFrom(`${now.slice(0, 8)}01`);
    else if (value === "last") {
      const d = new Date();
      d.setUTCDate(0);
      setTo(d.toISOString().slice(0, 10));
      d.setUTCDate(1);
      setFrom(d.toISOString().slice(0, 10));
    } else if (value !== "custom") setFrom(daysAgo(value === "24h" ? 1 : Number(value) - 1));
  };
  if (!me && (path === "/login" || path === "/setup" || path === "/config-invalid" || loading))
    return (
      <main class="auth">
        <a class="brand" href="#/">
          ◈ <span>Burnrate</span>
        </a>
        {loading ? (
          <p>Loading…</p>
        ) : path === "/config-invalid" ? (
          <>
            <p class="eyebrow">Configuration</p>
            <h1>Fix spend.config.ts</h1>
            <p>
              The configuration failed validation, so the dashboard stays closed. Run{" "}
              <code>npx vitest run test/unit/core.test.ts</code> to see each error (they are also in
              the Worker logs), fix them and redeploy.
            </p>
            <a href="https://github.com/ImLukeF/burnrate/blob/main/docs/configuration.md">
              Read the configuration reference ↗
            </a>
          </>
        ) : path === "/setup" ? (
          <>
            <p class="eyebrow">Getting started</p>
            <h1>Set up authentication</h1>
            <p>
              Authentication is not configured. Configure Cloudflare Access or a dashboard token
              before using the dashboard.
            </p>
            <ol>
              <li>Choose an authentication mode in your configuration.</li>
              <li>
                Set a <code>DASHBOARD_TOKEN</code> secret of at least 32 random characters, or the
                Cloudflare Access secrets.
              </li>
              <li>Refresh this page after updating the configuration.</li>
            </ol>
            <a href="https://github.com/ImLukeF/burnrate/blob/main/docs/auth.md">
              Read authentication setup ↗
            </a>
          </>
        ) : (
          <Login onSuccess={refresh} />
        )}
      </main>
    );
  return (
    <>
      <header class="header">
        <a class="brand" href="#/" aria-label="Burnrate overview">
          <span class="mark">◈</span>
          <span>Burnrate</span>
        </a>
        <nav aria-label="Main navigation">
          {nav.map(([href, label]) => (
            <a
              aria-current={
                path === href || (href === "/budgets" && path.startsWith("/budgets/"))
                  ? "page"
                  : undefined
              }
              class={
                path === href || (href === "/budgets" && path.startsWith("/budgets/"))
                  ? "active"
                  : ""
              }
              href={`#${href}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <div class="header-tools">
          <label class="sr-only" for="currency">
            Currency
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.currentTarget.value)}
          >
            {currencies.map((c) => (
              <option value={c}>{c}</option>
            ))}
          </select>
          {config.display?.tax?.enabled && (
            <label class="tax">
              <input
                type="checkbox"
                checked={tax}
                onChange={(e) => setTax(e.currentTarget.checked)}
              />{" "}
              incl. {config.display?.tax?.label || "tax"}
            </label>
          )}
          <span
            class={`fresh ${freshnessLevel}`}
            title={
              freshnessLevel === "fresh"
                ? "All providers synced within 45 minutes"
                : freshnessLevel === "stale"
                  ? "Provider data is delayed"
                  : "Provider data is stale or unavailable"
            }
          >
            <i />{" "}
            <span>
              {freshnessLevel === "fresh"
                ? "Data current"
                : freshnessLevel === "stale"
                  ? "Data delayed"
                  : "Data stale"}
            </span>
          </span>
          {me?.authMode === "token" && (
            <button
              type="button"
              class="quiet"
              onClick={async () => {
                try {
                  await request("/session", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json", "x-asd-csrf": "1" },
                  });
                  setMe(null);
                  location.hash = "#/login";
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main class="workspace">
        {error && (
          <div class="banner error" role="alert">
            {error}
            <button type="button" onClick={() => setError("")} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div class="banner" role="status">
            {notice}
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {path === "/" && (
          <>
            <div class="page-heading">
              <div>
                <p class="eyebrow">Spend overview</p>
                <h1>Overview</h1>
                <p>Organisation-wide usage and costs.</p>
              </div>
              <span class="updated">Updated {date(summary.generatedAt)}</span>
            </div>
            {rows(summary.warnings).map((w, i) => (
              <div class="banner warning" key={i}>
                {text(w.message ?? w)}
              </div>
            ))}
            {Number(summary.unpricedTokens) > 0 && (
              <div class="banner warning">
                {number(summary.unpricedTokens)} tokens have no pricing.
              </div>
            )}
            {freshness
              .filter((r) => r.lastError)
              .map((r) => (
                <div class="banner warning">
                  {text(r.provider)} sync: {text(r.lastError)}
                </div>
              ))}
            {budgets.some((b) => b.enforcement?.pending) && (
              <div class="banner warning">
                Enforcement actions are pending. Review budget activity for details.
              </div>
            )}
            <section class="metrics" aria-label="Spend totals">
              {[
                ["Today", "today"],
                ["Yesterday", "yesterday"],
                ["Week to date", "weekToDate"],
                ["Month to date", "monthToDate"],
                ["Month-end run rate (UTC)", "monthForecast"],
              ].map(([label, key]) => (
                <div>
                  <span
                    title={
                      key === "monthForecast"
                        ? "Month-to-date spend ÷ elapsed UTC hours × hours in this month. Includes today's partial UTC day; this is a projection, not a bill."
                        : undefined
                    }
                  >
                    {label}
                  </span>
                  <strong>{summaryMoney(summary.totals?.[key || ""])}</strong>
                </div>
              ))}
            </section>
            <section class="section">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Last 30 days</p>
                  <h2>Spend by provider</h2>
                </div>
                <a href="#/explore">Explore spend →</a>
              </div>
              <ChartView
                data={result[0]}
                label="Daily spend by provider"
                money={spendMoney(0)}
                currency={result[0]?.currency || "USD"}
              />
            </section>
            <div class="columns">
              <section class="section">
                <div class="section-heading">
                  <h2>Budgets</h2>
                  <a href="#/budgets">View all →</a>
                </div>
                <BudgetList budgets={budgets} money={money} />
              </section>
              <section class="section">
                <div class="section-heading">
                  <h2>Top keys</h2>
                  <span class="muted">Month to date</span>
                </div>
                <Ranked data={result[1]} money={spendMoney(1)} />
                <div class="section-heading subsection">
                  <h2>Top models</h2>
                  <span class="muted">Month to date</span>
                </div>
                <Ranked data={result[2]} money={spendMoney(2)} />
              </section>
            </div>
          </>
        )}
        {path === "/explore" && (
          <>
            <PageTitle
              title="Explore"
              description="Compare usage and spend across your organisation."
            />
            <div class="filters">
              <label>
                Period
                <select value={range} onChange={(e) => setPreset(e.currentTarget.value)}>
                  {[
                    ["24h", "Last 24 hours"],
                    ["7", "Last 7 days"],
                    ["30", "Last 30 days"],
                    ["90", "Last 90 days"],
                    ["mtd", "Month to date"],
                    ["last", "Last month"],
                    ["custom", "Custom"],
                  ].map(([v, l]) => (
                    <option value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.currentTarget.value);
                    setRange("custom");
                  }}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.currentTarget.value);
                    setRange("custom");
                  }}
                />
              </label>
              <label>
                Group by
                <select value={group} onChange={(e) => setGroup(e.currentTarget.value)}>
                  <option value="provider">Provider</option>
                  <option value="workspace">Workspace / project</option>
                  <option value="api_key">API key</option>
                  <option value="model">Model</option>
                  {rows(config.tags).map((t: Row) => (
                    <option value={`tag:${t.dimension}`}>{t.dimension}</option>
                  ))}
                </select>
              </label>
              <label>
                Provider
                <select value={filter} onChange={(e) => setFilter(e.currentTarget.value)}>
                  <option value="">All providers</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </label>
              <label>
                Workspace / project
                <input
                  value={workspace}
                  onInput={(e) => setWorkspace(e.currentTarget.value)}
                  placeholder="Any"
                />
              </label>
              <label>
                API key
                <input
                  value={apiKey}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  placeholder="Any"
                />
              </label>
              <label>
                Model
                <input
                  value={model}
                  onInput={(e) => setModel(e.currentTarget.value)}
                  placeholder="Any"
                />
              </label>
              <label>
                Tag
                <input
                  value={tag}
                  onInput={(e) => setTag(e.currentTarget.value)}
                  placeholder="dimension:value"
                />
              </label>
              <a class="button secondary" href={`${API}/export/spend.csv?${spendQuery}`}>
                Export CSV ↓
              </a>
            </div>
            <section class="section">
              <div class="section-heading">
                <h2>{range === "24h" ? "Hourly usage" : "Spend over time"}</h2>
                <span class="muted">
                  {from} — {to}
                </span>
              </div>
              <ChartView
                data={range === "24h" ? result[1] : result[0]}
                label={range === "24h" ? "Hourly token usage" : "Spend over time"}
                money={range === "24h" ? number : spendMoney(0)}
                currency={range === "24h" ? undefined : result[0]?.currency || "USD"}
              />
            </section>
            <section class="section">
              <h2>Breakdown</h2>
              <SpendTable data={result[0]} money={spendMoney(0)} number={number} />
            </section>
          </>
        )}
        {path === "/budgets" && (
          <>
            <PageTitle title="Budgets" description="Track limits and forecasted spend." />
            <BudgetList budgets={budgets} money={money} />
          </>
        )}
        {path.startsWith("/budgets/") && <BudgetDetail data={result[0] || {}} money={money} />}
        {path === "/keys" && (
          <>
            <PageTitle
              title="Keys & workspaces"
              description="Provider entities and their month-to-date spend."
            />
            <EntityTable data={result[0]} money={money} />
          </>
        )}
        {path === "/activity" && (
          <>
            <PageTitle
              title="Activity"
              description="Alerts, enforcement actions and sync events."
            />
            <div class="filters">
              <label>
                Event type
                <select value={eventType} onChange={(e) => setEventType(e.currentTarget.value)}>
                  <option value="">All activity</option>
                  <option value="budget">Alerts</option>
                  <option value="enforcement">Enforcement</option>
                  <option value="sync">Sync</option>
                </select>
              </label>
            </div>
            <Events data={result[0]} />
          </>
        )}
        {path === "/settings" && (
          <Settings
            status={result[0] || {}}
            config={config}
            me={me}
            summary={summary}
            action={action}
          />
        )}
        <footer>
          FX: ECB euro reference rates via Frankfurter; USD cross-rates are derived. For information
          only. Tax-inclusive amounts are for budgeting only.
        </footer>
      </main>
    </>
  );
}
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <p class="eyebrow">Welcome back</p>
      <h1>Sign in</h1>
      <p>Enter your dashboard token to continue.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await request("/session", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-asd-csrf": "1" },
              body: JSON.stringify({ token }),
            });
            setToken("");
            location.hash = "#/";
            onSuccess();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          Dashboard token
          <input
            type="password"
            value={token}
            onInput={(e) => setToken(e.currentTarget.value)}
            required
            autocomplete="current-password"
          />
        </label>
        {error && (
          <p role="alert" class="error-text">
            {error}
          </p>
        )}
        <button type="submit">Sign in</button>
      </form>
    </>
  );
}
function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div class="page-heading">
      <div>
        <p class="eyebrow">Burnrate</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function BudgetList({
  budgets,
  money,
}: {
  budgets: Row[];
  money: (n: unknown, unit?: string) => string;
}) {
  if (!budgets.length) return <Empty>No budgets to show.</Empty>;
  return (
    <div class="budget-list">
      {budgets.map((b, i) => (
        <a class="budget" href={`#/budgets/${encodeURIComponent(b.id || "")}`} key={i}>
          <div class="budget-line">
            <strong>{text(b.name ?? b.id)}</strong>
            <span class={`status ${text(b.status, "ok")}`}>{text(b.status, "ok")}</span>
          </div>
          <div class="budget-line muted">
            <span>
              {money(b.spent, b.currency || "USD")} of{" "}
              {money(b.limit, b.limitCurrency || b.currency || "USD")}
            </span>
            <span>{numberPercent(b.percent)}</span>
          </div>
          {b.warnings?.map((warning, index) => (
            <span class="budget-warning" key={index}>
              {text(typeof warning === "string" ? warning : (warning.message ?? warning))}
            </span>
          ))}
          <progress
            class="progress"
            aria-label={`${text(b.name)} budget`}
            value={Math.min(100, Math.max(0, Number(b.percent) || 0))}
            max={100}
          />
        </a>
      ))}
    </div>
  );
}
function numberPercent(n: unknown) {
  return n === undefined || n === null
    ? "—"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(n) || 0)}%`;
}
function Ranked({ data, money }: { data: unknown; money: (n: unknown) => string }) {
  const items = rows(data, "groups", "totals", "series", "data", "rows");
  if (!items.length) return <Empty />;
  const totals = new Map<string, number>();
  for (const r of items) {
    const name = text(r.group ?? r.name ?? r.label ?? r.model ?? r.apiKey);
    totals.set(
      name,
      (totals.get(name) || 0) +
        Number(r.amount ?? r.quantity ?? r.spend ?? r.spent ?? r.value ?? 0),
    );
  }
  return (
    <ol class="ranked">
      {[...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, amount]) => (
          <li>
            <span title={name}>{name}</span>
            <strong>{money(amount)}</strong>
          </li>
        ))}
    </ol>
  );
}
function SpendTable({
  data,
  money,
  number,
}: {
  data: unknown;
  money: (n: unknown) => string;
  number: (n: unknown) => string;
}) {
  const items = rows(data, "groups", "totals", "series", "data", "rows");
  if (!items.length) return <Empty />;
  const groups = new Map<
    string,
    {
      name: string;
      amount: number;
      tokens: number;
      requests: number;
      basisMix: Record<"billed" | "allocated" | "estimated", number>;
    }
  >();
  for (const r of items) {
    const name = text(r.group ?? r.name ?? r.label ?? r.provider);
    const current = groups.get(name) || {
      name,
      amount: 0,
      tokens: 0,
      requests: 0,
      basisMix: { billed: 0, allocated: 0, estimated: 0 },
    };
    current.amount += Number(r.amount ?? r.spend ?? r.value ?? 0);
    current.tokens += Number(r.tokens ?? 0);
    current.requests += Number(r.requests ?? 0);
    for (const basis of ["billed", "allocated", "estimated"] as const)
      current.basisMix[basis] =
        (current.basisMix[basis] || 0) +
        Number(r.basisMix?.[basis] ?? (r.basis === basis ? (r.amount ?? 0) : 0));
    groups.set(name, current);
  }
  const total = [...groups.values()].reduce((sum, row) => sum + row.amount, 0);
  return (
    <Table headings={["Group", "Spend", "Share", "Tokens", "Requests", "Basis"]}>
      {[...groups.values()]
        .sort((a, b) => b.amount - a.amount)
        .map((r, i) => (
          <tr key={i}>
            <td>{r.name}</td>
            <td class={r.basisMix.estimated ? "estimated" : ""}>{money(r.amount)}</td>
            <td>{numberPercent(total ? (r.amount / total) * 100 : 0)}</td>
            <td>{number(r.tokens)}</td>
            <td>{number(r.requests)}</td>
            <td>
              <BasisMix row={r} />
            </td>
          </tr>
        ))}
    </Table>
  );
}
function BudgetDetail({
  data,
  money,
}: {
  data: Row;
  money: (n: unknown, unit?: string) => string;
}) {
  const b = data?.budget || data || {};
  return (
    <>
      <a class="back" href="#/budgets">
        ← All budgets
      </a>
      <PageTitle
        title={text(b.name ?? b.id, "Budget")}
        description={`${text(b.period, "Current")} period`}
      />
      <BudgetList budgets={b.id ? [b] : []} money={money} />
      <div class="detail-grid">
        <div>
          <span>Forecast</span>
          <strong>{money(b.forecast, b.currency || "USD")}</strong>
        </div>
        <div>
          <span>Thresholds hit</span>
          <strong>{text(b.thresholdsHit ?? b.thresholds_hit)}</strong>
        </div>
        <div>
          <span>Enforcement</span>
          <strong>{text(b.enforcement?.mode ?? b.enforcement)}</strong>
        </div>
      </div>
      <section class="section">
        <h2>Period history</h2>
        <ChartView
          data={data?.history ?? data?.periods}
          label="Budget period history"
          money={(n) => money(n, b.currency || "USD")}
        />
      </section>
      <section class="section">
        <h2>Events</h2>
        <Events data={data?.events} />
      </section>
      <section class="section">
        <h2>Enforcement actions</h2>
        <Events data={data?.actions} />
      </section>
    </>
  );
}
function EntityTable({ data, money }: { data: unknown; money: (n: unknown) => string }) {
  const items = rows(data, "entities", "items", "data", "rows");
  return (
    <>
      {rows(data, "warnings").map((warning, i) => (
        <div class="banner warning" key={i}>
          {text(warning.message ?? warning)}
        </div>
      ))}
      {!items.length && <Empty>No keys or workspaces found.</Empty>}
      {items.some((r) => r.duplicateName || r.duplicate_name) && (
        <div class="banner warning">
          Some OpenRouter keys share a name; their usage may be ambiguous.
        </div>
      )}
      {items.some((r) => r.protected) && (
        <div class="banner">Protected keys cannot be changed by enforcement.</div>
      )}
      {items.length > 0 && (
        <Table
          headings={[
            "Provider",
            "Name / ID",
            "Workspace / project",
            "Status",
            "Tags",
            "Month to date",
            "Last used",
          ]}
        >
          {items.map((r, i) => (
            <tr key={i}>
              <td>{text(r.provider)}</td>
              <td>
                <strong>{text(r.name)}</strong>
                <small>
                  {short(r.id)} {r.protected && "· Protected"}{" "}
                  {(r.duplicateName || r.duplicate_name) && "· Duplicate name"}
                </small>
              </td>
              <td>{text(r.workspaceName ?? r.workspace ?? r.projectName)}</td>
              <td>
                <span class="status">{text(r.status)}</span>
              </td>
              <td>
                <Tags value={r.tags} />
              </td>
              <td>{money(r.monthToDate ?? r.mtdSpend ?? r.spend)}</td>
              <td>{date(r.lastUsedAt ?? r.last_used_at ?? r.lastUsed)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
function Events({ data }: { data: unknown }) {
  const items = rows(data, "events", "items", "data", "rows");
  if (!items.length) return <Empty>No activity to show.</Empty>;
  return (
    <div class="events">
      {items.map((r, i) => (
        <article class="event" key={i}>
          <span class="event-dot" />
          <div>
            <div class="budget-line">
              <strong>
                {text(r.title ?? r.message ?? r.payload?.message ?? r.type ?? r.action_type)}
              </strong>
              <time>{date(r.createdAt ?? r.created_at ?? r.at ?? r.timestamp)}</time>
            </div>
            <p>{text(r.description ?? r.detail ?? r.payload?.description, "")}</p>
            {r.status && <span class="status">{text(r.status)}</span>}
            {rows(r.deliveries).map((d, j) => (
              <span class="delivery" key={j}>
                {text(d.channel ?? d.channelId ?? d.channel_id)}: {text(d.status)}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
function Settings({
  status,
  config,
  me,
  summary,
  action,
}: {
  status: Row;
  config: Row;
  me: Row | null;
  summary: Row;
  action: (path: string, body?: Row) => void;
}) {
  const jobs = rows(status, "jobs", "providers", "syncState");
  const channels = rows(status, "channels");
  return (
    <>
      <PageTitle
        title="Settings & status"
        description="Configuration is managed in spend.config.ts."
      />
      <div class="settings-actions">
        {me?.canAdmin && (
          <button type="button" onClick={() => action("/admin/sync")}>
            Sync now
          </button>
        )}
        <a href="https://github.com/ImLukeF/burnrate/blob/main/docs/configuration.md">
          Configuration docs ↗
        </a>
      </div>
      <section class="section">
        <h2>System</h2>
        <dl class="definition">
          <div>
            <dt>Configuration</dt>
            <dd>{status?.configValid === false ? "Invalid" : "Valid"}</dd>
          </div>
          <div>
            <dt>Authentication</dt>
            <dd>{text(me?.authMode)}</dd>
          </div>
          <div>
            <dt>Schema version</dt>
            <dd>{text(status?.schemaVersion)}</dd>
          </div>
          <div>
            <dt>App version</dt>
            <dd>{text(status?.version)}</dd>
          </div>
          <div>
            <dt>Last tick</dt>
            <dd>{date(status?.lastTick?.at)}</dd>
          </div>
          <div>
            <dt>FX source</dt>
            <dd>{text(summary.fx?.source)}</dd>
          </div>
          <div>
            <dt>Latest FX rate</dt>
            <dd>
              {text(summary.fx?.rate)} · {text(summary.fx?.day)}
            </dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{config.display?.tax?.enabled ? text(config.display.tax.label) : "Not enabled"}</dd>
          </div>
        </dl>
        {rows(status?.configErrors).map((e, i) => (
          <p class="error-text" key={i}>
            {text(e)}
          </p>
        ))}
      </section>
      <section class="section">
        <h2>Providers</h2>
        {status.syntheticDemo && (
          <p class="banner">
            Synthetic demo data is loaded. Stored spend does not mean a provider is configured or
            has been synced.
          </p>
        )}
        {rows(status, "providers").length ? (
          <Table
            headings={["Provider", "Configuration", "Credential", "Stored spend", "Last data sync"]}
          >
            {rows(status, "providers").map((p, i) => (
              <tr key={i}>
                <td>{text(p.provider)}</td>
                <td>
                  {p.status === "configured"
                    ? "Configured"
                    : p.status === "disabled"
                      ? "Disabled"
                      : "Not configured"}
                </td>
                <td>{p.configured ? "Set" : "Not set"}</td>
                <td>{p.hasData ? "Available" : "None"}</td>
                <td>{p.lastSuccessAt ? date(p.lastSuccessAt) : "Never"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No providers configured.</Empty>
        )}
      </section>
      <section class="section">
        <h2>Sync jobs</h2>
        {jobs.length ? (
          <Table
            headings={[
              "Provider / job",
              "Status",
              "Last success",
              "Last error",
              "Rows",
              "Next due",
            ]}
          >
            {jobs.map((r, i) => (
              <tr key={i}>
                <td>{text(r.job ?? r.name ?? r.provider)}</td>
                <td>{text(r.enabled === false ? "Disabled" : (r.status ?? "Enabled"))}</td>
                <td>{date(r.lastSuccessAt ?? r.last_success_at)}</td>
                <td>{text(r.lastError ?? r.last_error)}</td>
                <td>{text(r.rows ?? r.last_rows)}</td>
                <td>{date(r.nextDueAt ?? r.next_due_at)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No sync status available.</Empty>
        )}
      </section>
      <section class="section">
        <h2>Alert channels</h2>
        {channels.length ? (
          <Table headings={["Channel", "Type", "Secret", "Action"]}>
            {channels.map((c, i) => (
              <tr key={i}>
                <td>{text(c.name ?? c.id)}</td>
                <td>{text(c.type)}</td>
                <td>{c.configured === true ? "Set" : c.configured === false ? "Not set" : "—"}</td>
                <td>
                  {me?.canAdmin && (
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => action("/admin/test-alert", { channelId: c.id })}
                    >
                      Send test
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No alert channels configured.</Empty>
        )}
      </section>
    </>
  );
}

const mount = document.getElementById("app");
if (mount) render(<App />, mount);
