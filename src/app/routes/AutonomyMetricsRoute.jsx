import { jsx as e, jsxs as a } from "react/jsx-runtime";
import c from "react";
import { buildAuthHeaders, readBrowserSessionConfig, resolveApiBaseUrl } from "../session.browser";

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "0%";
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "0";
}

function metricRows(summary = {}) {
  return [
    { label: "Autonomous delivery", value: formatPercent(summary.autonomous_delivery_rate), detail: `${formatNumber(summary.autonomous_deliveries)} clean deliveries` },
    { label: "Included signals", value: formatNumber(summary.included_signals), detail: `${formatNumber(summary.unknown_signals)} unknown excluded` },
    { label: "Operator interventions", value: formatNumber(summary.operator_interventions_total), detail: `${formatPercent(summary.operator_intervention_rate)} rate` },
    { label: "QA/SRE rework", value: formatNumber(summary.qa_sre_rework_total), detail: `${formatPercent(summary.qa_sre_rework_rate)} rate` },
    { label: "Rollbacks", value: formatNumber(summary.rollback_total), detail: `${formatPercent(summary.rollback_rate)} rate` },
    { label: "Escaped defects", value: formatNumber(summary.escaped_defects_total), detail: `${formatPercent(summary.escaped_defect_rate)} rate` },
  ];
}

function breakdownRows(data = {}) {
  return [
    ...(data.by_task_class || []).map((row) => ({ ...row, group: "Task class" })),
    ...(data.by_template_tier || []).map((row) => ({ ...row, group: "Tier" })),
    ...(data.by_implementation_agent || []).map((row) => ({ ...row, group: "Agent" })),
  ];
}

function latestSignals(signals = []) {
  return [...signals].slice(0, 8);
}

function MetricsToolbar({ includeUnknown, setIncludeUnknown, load, rebuild, busy }) {
  return a("div", { className: "autonomy-metrics__toolbar", children: [
    a("label", { className: "autonomy-metrics__toggle", children: [
      e("input", { type: "checkbox", checked: includeUnknown, onChange: (event) => setIncludeUnknown(event.target.checked) }),
      e("span", { children: "Include unknown evidence" }),
    ] }),
    e("button", { type: "button", className: "button-secondary", onClick: load, disabled: busy, children: "Refresh" }),
    e("button", { type: "button", onClick: rebuild, disabled: busy, children: "Rebuild" }),
  ] });
}

function MetricsGrid({ rows }) {
  return a("div", { className: "autonomy-metrics__grid", children: rows.map((row) => a("article", { className: "autonomy-metric", children: [
    e("span", { className: "autonomy-metric__label", children: row.label }),
    e("strong", { children: row.value }),
    e("span", { className: "autonomy-metric__detail", children: row.detail }),
  ] }, row.label)) });
}

function BreakdownPanel({ rows }) {
  return a("section", { className: "autonomy-metrics__panel", "aria-labelledby": "autonomy-breakdown-heading", children: [
    e("h2", { id: "autonomy-breakdown-heading", children: "Metric breakdown" }),
    rows.length ? e("div", { className: "task-list-table-wrap autonomy-metrics__table-wrap", children: a("table", { className: "task-list-table", children: [
      e("thead", { children: a("tr", { children: ["Group", "Key", "Included", "Autonomous", "Intervention rate"].map((label) => e("th", { scope: "col", children: label }, label)) }) }),
      e("tbody", { children: rows.map((row) => a("tr", { children: [
        e("td", { children: row.group }),
        e("td", { children: row.key }),
        e("td", { children: formatNumber(row.included) }),
        e("td", { children: formatNumber(row.autonomous) }),
        e("td", { children: formatPercent(row.operator_intervention_rate) }),
      ] }, `${row.group}:${row.key}`)) }),
    ] }) }) : e("p", { className: "task-list-empty", children: "No breakdown rows are available yet." }),
  ] });
}

function SignalsPanel({ signals }) {
  return a("section", { className: "autonomy-metrics__panel", "aria-labelledby": "autonomy-signals-heading", children: [
    e("h2", { id: "autonomy-signals-heading", children: "Latest signals" }),
    signals.length ? e("div", { className: "task-list-table-wrap autonomy-metrics__table-wrap", children: a("table", { className: "task-list-table", children: [
      e("thead", { children: a("tr", { children: ["Task", "Class", "Agent", "Status", "Interventions"].map((label) => e("th", { scope: "col", children: label }, label)) }) }),
      e("tbody", { children: signals.map((signal) => a("tr", { children: [
        e("td", { children: e("a", { href: `/tasks/${encodeURIComponent(signal.task_id)}`, children: signal.task_id }) }),
        e("td", { children: signal.task_class || "Unknown" }),
        e("td", { children: signal.implementation_agent || "Unknown" }),
        e("td", { children: signal.classification_status }),
        e("td", { children: formatNumber(signal.operator_interventions?.count) }),
      ] }, signal.signal_id)) }),
    ] }) }) : e("p", { className: "task-list-empty", children: "No retrospective signals are available yet." }),
  ] });
}

function SignalFacts({ signal }) {
  return a("dl", { className: "autonomy-metrics__signal-facts", children: [
    e("dt", { children: "Task" }),
    e("dd", { children: signal.task_id }),
    e("dt", { children: "Evidence status" }),
    e("dd", { children: signal.classification_status }),
    e("dt", { children: "Final outcome" }),
    e("dd", { children: signal.final_outcome?.status || "Unknown" }),
    e("dt", { children: "QA/SRE rework" }),
    e("dd", { children: formatNumber(signal.qa_sre_rework?.rework_count) }),
    e("dt", { children: "Rollback" }),
    e("dd", { children: signal.rollback?.recorded ? "Recorded" : "Not recorded" }),
    e("dt", { children: "Escaped defects" }),
    e("dd", { children: formatNumber(signal.escaped_defects?.count) }),
  ] });
}

function RetrospectivePanel({ signal, unknownSignals }) {
  return a("section", { className: "autonomy-metrics__panel", "aria-labelledby": "autonomy-retrospective-heading", children: [
    e("h2", { id: "autonomy-retrospective-heading", children: "Task retrospective signal" }),
    signal ? e(SignalFacts, { signal }) : e("p", { className: "task-list-empty", children: "No task-level retrospective signal is available yet." }),
    unknownSignals ? e("p", { className: "autonomy-metrics__unknown-note", children: "Unknown legacy evidence is excluded from threshold decisions unless included explicitly." }) : null,
  ] });
}

async function fetchAutonomyJson(url, options, fallbackMessage) {
  const response = await window.fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || fallbackMessage);
  return payload.data;
}

function useAutonomyMetricsState(ctx = {}) {
  const session = ctx.u || readBrowserSessionConfig();
  const baseUrl = ctx.D || resolveApiBaseUrl(session, ctx.At || "");
  const [includeUnknown, setIncludeUnknown] = c.useState(false);
  const [state, setState] = c.useState({ kind: "loading", data: null, message: "Loading autonomous delivery metrics." });
  const load = c.useCallback(async () => {
    setState((current) => ({ kind: current.data ? "refreshing" : "loading", data: current.data, message: "Loading autonomous delivery metrics." }));
    const params = new URLSearchParams();
    includeUnknown && params.set("includeUnknown", "true");
    try {
      const data = await fetchAutonomyJson(`${baseUrl}/v1/metrics/autonomous-delivery${params.toString() ? `?${params}` : ""}`, {
        credentials: "same-origin",
        headers: buildAuthHeaders(session),
      }, "Autonomous delivery metrics are unavailable.");
      setState({ kind: "ready", data, message: "Autonomous delivery metrics loaded." });
    } catch (error) {
      setState((current) => ({ kind: "error", data: current.data, message: error?.message || "Autonomous delivery metrics are unavailable." }));
    }
  }, [baseUrl, includeUnknown, session]);
  c.useEffect(() => {
    load();
  }, [load]);
  const rebuild = c.useCallback(async () => {
    setState((current) => ({ ...current, kind: "refreshing", message: "Rebuilding autonomous delivery metrics." }));
    try {
      const data = await fetchAutonomyJson(`${baseUrl}/v1/metrics/autonomous-delivery/rebuild`, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...buildAuthHeaders(session), "content-type": "application/json" },
        body: JSON.stringify({ includeUnknown, persist: true }),
      }, "Metrics rebuild failed.");
      setState({ kind: "ready", data, message: "Metrics rebuild completed." });
    } catch (error) {
      setState((current) => ({ ...current, kind: "error", message: error?.message || "Metrics rebuild failed." }));
    }
  }, [baseUrl, includeUnknown, session]);
  return { includeUnknown, setIncludeUnknown, state, load, rebuild };
}

function AutonomyMetricsRoute({ ctx = {} }) {
  const { includeUnknown, setIncludeUnknown, state, load, rebuild } = useAutonomyMetricsState(ctx);

  const data = state.data;
  const summary = data?.summary || {};
  const rows = metricRows(summary);
  const grouped = breakdownRows(data?.breakdowns || {});
  const signals = latestSignals(data?.signals || []);
  const inspectedSignal = signals[0] || null;
  const busy = state.kind === "loading" || state.kind === "refreshing";

  return a("section", { className: "autonomy-metrics", "aria-label": "Autonomous delivery metrics dashboard", children: [
    e(MetricsToolbar, { includeUnknown, setIncludeUnknown, load, rebuild, busy }),
    e("div", { role: state.kind === "error" ? "alert" : "status", className: `autonomy-metrics__status autonomy-metrics__status--${state.kind}`, children: state.message }),
    data ? e(MetricsGrid, { rows }) : null,
    data ? a("div", { className: "autonomy-metrics__columns", children: [
      e(BreakdownPanel, { rows: grouped }),
      e(SignalsPanel, { signals }),
    ] }) : null,
    data ? e(RetrospectivePanel, { signal: inspectedSignal, unknownSignals: summary.unknown_signals }) : null,
  ] });
}

export {
  AutonomyMetricsRoute,
};
