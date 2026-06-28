import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";
import c from "react";
import { LiveTaskFreshnessIndicator, useLiveTaskFreshnessPolling } from "../live-task-freshness";

function TaskWorkspaceRoute({ ctx }) {
  const {
    _, A, ae, Ae, At, bi, bs, da, En,
    f, Fi, fn, ft, gi, h, H, hi,
    ht, it, j, J, Ja, k, ki, l,
    La, Li, lt, Mn, Ms, N, ne, Ne, projectOptions,
    o, oi, os, P, Pt, Qa, qn, Rt,
    Ss, u, Un, Va, vi, we, wt, x, xa,
    xt, ye, Yt, zs } = ctx;
  const liveFreshness = useLiveTaskFreshnessPolling({ session: u, defaultBaseUrl: At, scope: { kind: "list", pathname: ctx.i || "" }, onUpdates: k });
  const isCommandCenter = !f && !_ && !P && !A, selectedTaskId = isCommandCenter ? new URLSearchParams(o).get("selectedTask") || "" : "", selectedTask = selectedTaskId ? Ae.find((t) => t.task_id === selectedTaskId) || null : null, buildQueueTaskHref = (t) => {
    const n = new URLSearchParams(o);
    n.set("selectedTask", t);
    return `/tasks?${n.toString()}`;
  }, updateQueueSelection = (t) => {
    const n = new URLSearchParams(o);
    t ? n.set("selectedTask", t) : n.delete("selectedTask");
    l("/tasks", n.toString() ? `?${n.toString()}` : "");
  }, autoSelectedRef = c.useRef(false);
  c.useEffect(() => {
    if (!isCommandCenter || selectedTaskId || x.kind !== "ready" || !Ae.length || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    updateQueueSelection(Ae[0].task_id);
  }, [isCommandCenter, selectedTaskId, x.kind, Ae[0]?.task_id]);
  return a("section", { className: `task-list-panel${isCommandCenter ? " task-list-panel--command-center" : selectedTask ? " task-list-panel--inspector-open" : ""}`, "aria-label": _ ? "PM overview view" : P ? "\
Governance reviews view" : A ? "Deferred Considerations review queue" : f ? `${H(f)} inbox view` : "Task workspace view", children: [e("div", { className: "task\
-list-toolbar", children: _ ? a("div", { className: "role-inbox-toolbar", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Cross-role \
overview" }), e("h2", { children: "PM grouped list overview" }), e("p", { className: "role-inbox-toolbar__cue", children: "Tasks are grouped into routing bucket\
s in one read-only list. Use the single bucket filter to focus on one section and clear it to restore the grouped overview." })] }), a("div", { className: "task\
-list-toolbar__actions", children: [a("label", { children: ["Bucket filter", a("select", { "aria-label": "Bucket filter", value: ae, onChange: (t) => l("/overvi\
ew/pm", we({ bucket: t.target.value }, o)), children: [e("option", { value: "", children: "All buckets" }), Un.map((t) => e("option", { value: t, children: qn(t) },
  t))] })] }), e("button", { type: "button", className: "button-secondary", onClick: () => l("/overview/pm", we({ bucket: "" }, o)), disabled: !ae, children: "C\
lear filter" }), e("button", { type: "button", onClick: () => {
    k();
  }, children: "Refresh" })] })] }) : P ? a("div", { className: "role-inbox-toolbar", children: [a("div", { children: [e("p", { className: "eyebrow", children: "\
Operational governance" }), e("h2", { children: "Governance review queue" }), e("p", { className: "role-inbox-toolbar__cue", children: "Inactivity review and go\
vernance follow-up tasks live here so they remain visible without mixing into normal delivery views." })] }), a("div", { className: "task-list-toolbar__actions",
  children: [e("button", { type: "button", className: "button-secondary", onClick: () => l("/tasks"), children: "Open task workspace" }), e("button", { type: "b\
utton", onClick: () => {
    k();
  }, children: "Refresh" })] })] }) : A ? a("div", { className: "role-inbox-toolbar", children: [a("div", { children: [e("p", { className: "eyebrow", children: "\
PM review queue" }), e("h2", { children: "Deferred Considerations" }), e("p", { className: "role-inbox-toolbar__cue", children: "Captured ideas remain outside c\
ommitted scope until a PM or operator explicitly promotes them to a new Intake Draft." })] }), a("div", { className: "task-list-toolbar__actions", children: [e(
  "button", { type: "button", className: "button-secondary", onClick: () => l("/tasks"), children: "Open task workspace" }), e("button", { type: "button", onClick: () => {
    k();
  }, children: "Refresh" })] })] }) : f ? a("div", { className: "role-inbox-toolbar", children: [a("div", { children: [e("p", { className: "eyebrow", children: "\
Role inbox" }), a("h2", { children: [H(f), " inbox routing"] }), e("p", { className: "role-inbox-toolbar__cue", children: f === "sre" ? "Tasks appear here when \
they are actively in the SRE monitoring stage or when routing metadata explicitly points to SRE ownership." : f === "human" ? "Decision-ready items appear here \
only when governed close review or escalation handling is explicitly waiting on a human stakeholder decision." : `Tasks appear here only when their current assi\
gned owner resolves to the ${H(f)} canonical role. Unassigned tasks appear in no role inbox.` })] }), a("div", { className: "task-list-toolbar__actions", children: [
  e("button", { type: "button", className: "button-secondary", onClick: () => l("/tasks"), children: "Open task workspace" }), e("button", { type: "button", onClick: () => {
    k();
  }, children: "Refresh" })] })] }) : a(q, { children: [a("div", { className: "command-center-toolbar", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Command Center" }), e("h2", { children: "Queue-first task workspace" }), e("p", { className: "command-center-toolbar__cue", children: "Prioritized work stays in the primary queue. Select a task to update the persistent inspector without leaving this view." })] }), e("div", { className: "command-center-toolbar__badge", children: "Inspector active" })] }), a("label", { children: ["Owner filter", a("select", { "aria-label": "Owner filter", value: N.owner, onChange: (t) => Ss(
  t.target.value), children: [e("option", { value: "", children: "All owners" }), e("option", { value: Fi, children: "Unassigned" }), En(Ne).map((t) => e("optio\
n", { value: t.id, children: t.label }, t.id))] })] }), a("label", { children: ["Project filter", a("select", { "aria-label": "Project filter", value: N.project || "", onChange: (t) => wt({ project: t.target.value }), children: [e("option", { value: "", children: "All projects" }), projectOptions.map((t) => e("option", { value: t.projectId, children: t.name }, t.projectId))] })] }), a("label", { children: ["Priority filter", a("select", { "aria-label": "Priority filter", value: N.priority,
  onChange: (t) => wt({ priority: t.target.value }), children: [e("option", { value: "", children: "All priorities" }), gi.map((t) => e("option", { value: t, children: t },
  t))] })] }), a("label", { children: ["Status filter", a("select", { "aria-label": "Status filter", value: N.status, onChange: (t) => wt({ status: t.target.value }),
  children: [e("option", { value: "", children: "All statuses" }), vi.map((t) => e("option", { value: t, children: t }, t))] })] }), a("label", { children: ["Se\
arch tasks", e("input", { "aria-label": "Search tasks", value: N.searchTerm, onChange: (t) => wt({ searchTerm: t.target.value }), placeholder: "Task ID or title" })] }),
  a("div", { className: "task-list-toolbar__actions", children: [a("div", { className: "view-toggle", role: "tablist", "aria-label": "Task workspace view", children: [
  e("button", { type: "button", role: "tab", "aria-selected": N.view === "list", className: N.view === "list" ? "" : "button-secondary", onClick: () => fn("list"),
  children: "List" }), e("button", { type: "button", role: "tab", "aria-selected": N.view === "board", className: N.view === "board" ? "" : "button-secondary", onClick: () => fn(
  "board"), children: "Kanban board" })] }), e("button", { type: "button", className: "button-secondary", onClick: () => wt({ owner: "", priority: "", status: "",
  searchTerm: "", project: "" }), disabled: !La, children: "Clear all filters" }), e("button", { type: "button", onClick: () => {
    k();
  }, children: "Refresh" })] })] }) }), e(LiveTaskFreshnessIndicator, { state: liveFreshness, onManualRefresh: k }), e("p", { className: "task-list-results", role: "status", "aria-live": "polite", children: bi }), _ && x.kind === "loadin\
g" || P && x.kind === "loading" || A && x.kind === "loading" || !f && !_ && !P && !A && x.kind === "loading" || f && ne.kind === "loading" ? e("p", { role: "sta\
tus", children: f ? ne.message : _ ? "Loading PM overview." : P ? "Loading governance reviews." : A ? "Loading Deferred Considerations." : "Loading task workspa\
ce." }) : null, !f && !_ && !P && !A && x.kind === "error" || _ && x.kind === "error" || P && x.kind === "error" || A && x.kind === "error" ? e("p", { role: "al\
ert", children: x.message }) : null, _ && lt.kind === "error" && x.kind === "ready" ? a("div", { className: "empty-state", role: "alert", children: [e("h2", { children: "\
Some routing metadata is unavailable" }), e("p", { children: lt.message }), e("p", { className: "task-list-meta", children: "Tasks remain visible using safe fal\
lback labels, but canonical bucket routing may place affected rows in Needs routing attention." })] }) : null, f && ne.kind === "error" ? a("div", { className: "\
empty-state", role: "alert", children: [a("h2", { children: [H(f), " inbox temporarily degraded"] }), e("p", { children: ne.message }), e("p", { className: "tas\
k-list-meta", children: "This inbox waits for both `/tasks` and `/ai-agents` before confirming empty or routed results." })] }) : null, _ && x.kind === "ready" &&
  da.length ? e("div", { className: "task-list-table-wrap", children: da.map((t) => a("section", { "aria-labelledby": `pm-bucket-${t.key}`, className: "pm-overv\
iew-section", children: [a("div", { className: "task-board__column-header", children: [e("h2", { id: `pm-bucket-${t.key}`, children: t.label }), e("span", { children: t.
  items.length })] }), a("table", { className: "task-list-table", children: [e("thead", { children: a("tr", { children: [e("th", { scope: "col", children: "Task" }),
  e("th", { scope: "col", children: "Stage" }), e("th", { scope: "col", children: "Owner" }), e("th", { scope: "col", children: "Routing" })] }) }), e("tbody", {
  children: t.items.map((n) => a("tr", { children: [a("td", { children: [e("a", { href: `/tasks/${encodeURIComponent(n.task_id)}`, onClick: (r) => {
    r.preventDefault(), l(`/tasks/${encodeURIComponent(n.task_id)}`);
  }, children: e("strong", { children: n.title || n.task_id }) }), e("div", { className: "task-list-meta", children: n.task_id })] }), e("td", { children: n.current_stage ||
  "\u2014" }), a("td", { children: [e("span", { className: `owner-badge owner-badge--${n.ownerPresentation.tone}`, children: n.ownerPresentation.label }), e("di\
v", { className: "task-list-meta", children: n.pmBucket.degradedLabel || "Read-only owner metadata" })] }), a("td", { children: [e("span", { className: "routing\
-badge", children: n.pmBucket.routingCue }), e("div", { className: "task-list-meta", children: n.pmBucket.routingReason })] })] }, n.task_id)) })] })] }, t.key)) }) :
  null, A && x.kind === "ready" && Rt.length ? e("div", { className: "task-list-table-wrap", children: ki.map((t) => a("section", { className: "pm-overview-sect\
ion", "aria-labelledby": `deferred-consideration-group-${t.key.replace(/[^a-z0-9_-]/gi, "-")}`, children: [a("div", { className: "task-board__column-header", children: [
  e("h2", { id: `deferred-consideration-group-${t.key.replace(/[^a-z0-9_-]/gi, "-")}`, children: t.label }), e("span", { children: t.items.length })] }), a("tab\
le", { className: "task-list-table", "aria-label": `${t.label} Deferred Considerations`, children: [e("thead", { children: a("tr", { children: [e("th", { scope: "\
col", children: "Consideration" }), e("th", { scope: "col", children: "Source task" }), e("th", { scope: "col", children: "Owner" }), e("th", { scope: "col", children: "\
Revisit" }), e("th", { scope: "col", children: "Status" })] }) }), e("tbody", { children: t.items.map((n) => a("tr", { children: [a("td", { children: [e("strong",
  { children: n.title || n.id }), e("div", { className: "task-list-meta", children: n.id || n.deferred_consideration_id }), e("div", { className: "task-list-met\
a", children: n.rationale || "No rationale recorded." })] }), a("td", { children: [e("a", { href: `/tasks/${encodeURIComponent(n.sourceTaskId)}`, onClick: (r) => {
    r.preventDefault(), l(`/tasks/${encodeURIComponent(n.sourceTaskId)}`);
  }, children: n.sourceTaskTitle }), a("div", { className: "task-list-meta", children: [n.sourceTaskId, " \xB7 ", n.task?.current_stage || "\u2014"] })] }), e("\
td", { children: n.owner || "Unassigned" }), a("td", { children: [e("div", { children: n.revisit_date || n.revisit_trigger || "Not scheduled" }), e("div", { className: "\
task-list-meta", children: n.source_section || "No source section" })] }), e("td", { children: e("span", { className: "routing-badge", children: Ja(n.status) }) })] },
  `${n.sourceTaskId}-${n.id || n.deferred_consideration_id}`)) })] })] }, t.key)) }) : null, ne.kind === "ready" && f === "sre" && ye.length ? e("div", { className: "\
task-list-table-wrap", children: a("table", { className: "task-list-table", "aria-label": "SRE monitoring dashboard", children: [e("thead", { children: a("tr", {
  children: [e("th", { scope: "col", children: "Task" }), e("th", { scope: "col", children: "Risk" }), e("th", { scope: "col", children: "Time remaining" }), e(
  "th", { scope: "col", children: "Deployment" }), e("th", { scope: "col", children: "PR / Commit" }), e("th", { scope: "col", children: "Telemetry" }), e("th",
  { scope: "col", children: "Drilldowns" })] }) }), e("tbody", { children: ye.map((t) => a("tr", { children: [a("td", { children: [e("a", { href: `/tasks/${encodeURIComponent(
  t.task_id)}`, onClick: (n) => {
    n.preventDefault(), l(`/tasks/${encodeURIComponent(t.task_id)}`);
  }, children: e("strong", { children: t.title || t.task_id }) }), a("div", { className: "task-list-meta", children: [t.task_id, " \xB7 ", t.current_stage || "\u2014"] })] }),
  a("td", { children: [e("span", { className: "routing-badge", children: String(t.monitoring?.riskLevel || "unknown").toUpperCase() }), e("div", { className: "t\
ask-list-meta", children: t.queueReason.label })] }), a("td", { children: [e("strong", { children: t.monitoring?.timeRemainingLabel || "Not started" }), e("div",
  { className: "task-list-meta", children: t.monitoring?.windowEndsAt || "No deadline yet" })] }), a("td", { children: [e("div", { children: t.monitoring?.deployment?.
  environment || "No deploy recorded" }), a("div", { className: "task-list-meta", children: [t.monitoring?.deployment?.version || "No version", t.monitoring?.deployment?.
  url ? ` \xB7 ${t.monitoring.deployment.url}` : ""] })] }), a("td", { children: [e("div", { children: t.monitoring?.linkedPrs?.[0]?.number ? `PR #${t.monitoring.
  linkedPrs[0].number}` : "No merged PR" }), e("div", { className: "task-list-meta", children: t.monitoring?.commitSha || "No commit snapshot" })] }), a("td", {
  children: [a("div", { children: ["Freshness: ", t.monitoring?.telemetry?.freshness || "unknown"] }), a("div", { className: "task-list-meta", children: ["Event\
s: ", t.monitoring?.telemetry?.eventCount ?? 0] })] }), e("td", { children: a("div", { className: "task-list-meta", children: [t.monitoring?.telemetry?.drilldowns?.
  metrics ? e("a", { href: t.monitoring.telemetry.drilldowns.metrics, target: "_blank", rel: "noreferrer", children: "Metrics" }) : "Metrics unavailable", " \xB7 ",
  t.monitoring?.telemetry?.drilldowns?.logs ? e("a", { href: t.monitoring.telemetry.drilldowns.logs, target: "_blank", rel: "noreferrer", children: "Logs" }) : "\
Logs unavailable", " \xB7 ", t.monitoring?.telemetry?.drilldowns?.traces ? e("a", { href: t.monitoring.telemetry.drilldowns.traces, target: "_blank", rel: "nore\
ferrer", children: "Traces" }) : "Traces unavailable"] }) })] }, t.task_id)) })] }) }) : null, ne.kind === "ready" && f === "human" && ye.length ? e("div", { className: "\
decision-inbox-list", "aria-label": "Human decision queue", children: ye.map((t) => {
    const n = t.close_governance || {}, r = n.cancellation?.recommendations || {}, d = n.escalation || null, m = n.humanDecision?.latestDecision || null, v = xa[t.
    task_id] || os(t), Z = bs[t.task_id] || { kind: "idle", message: "" };
    return a("article", { className: "detail-card detail-card--full decision-inbox-card", children: [a("div", { className: "decision-inbox-card__header", children: [
    a("div", { children: [e("p", { className: "eyebrow", children: "Human decision required" }), e("h3", { children: e("a", { href: `/tasks/${encodeURIComponent(
    t.task_id)}`, onClick: (ge) => {
      ge.preventDefault(), l(`/tasks/${encodeURIComponent(t.task_id)}`);
    }, children: t.title || t.task_id }) }), a("p", { className: "task-list-meta", children: [t.task_id, " \xB7 ", t.current_stage || "\u2014", " \xB7 ", t.priority ||
    "\u2014", " priority"] })] }), a("div", { className: "decision-inbox-card__meta", children: [e("span", { className: "routing-badge", children: t.queueReason.
    label }), e("span", { className: `owner-badge owner-badge--${t.ownerPresentation.tone}`, children: t.ownerPresentation.label })] })] }), a("div", { className: "\
review-question-note", children: [e("span", { children: "Decision summary" }), e("p", { children: n.humanDecision?.summary || d?.summary || t.next_required_action ||
    "Governed close review is waiting on a human decision." }), e("p", { className: "task-list-meta", children: t.queueReason.detail })] }), r.pm || r.architect ?
    a("div", { className: "review-question-note", children: [e("span", { children: "Recommendation snapshot" }), r.pm ? a("div", { className: "review-question-n\
ote__recommendation", children: [a("p", { children: [e("strong", { children: "PM:" }), " ", r.pm.summary || "Recommendation recorded."] }), r.pm.rationale ? e("\
p", { className: "task-list-meta", children: r.pm.rationale }) : null] }, "pm-recommendation") : null, r.architect ? a("div", { className: "review-question-note\
__recommendation", children: [a("p", { children: [e("strong", { children: "Architect:" }), " ", r.architect.summary || "Recommendation recorded."] }), r.architect.
    rationale ? e("p", { className: "task-list-meta", children: r.architect.rationale }) : null] }, "architect-recommendation") : null] }) : null, d ? a("div", {
    className: "review-question-note", children: [e("span", { children: d.source === "monitoring_expiry" ? "Monitoring expiry escalation" : "Exceptional dispute\
 escalation" }), a("p", { children: [e("strong", { children: "Recommendation:" }), " ", d.recommendation || "Human review required."] }), d.rationale ? e("p", {
    className: "task-list-meta", children: d.rationale }) : null, a("p", { className: "task-list-meta", children: [String(d.severity || "warning").toUpperCase(),
    " \xB7 ", d.occurredAt || "No timestamp recorded"] })] }) : null, m ? a("div", { className: "review-question-note", children: [e("span", { children: "Latest\
 decision" }), e("p", { children: e("strong", { children: Va(n.humanDecision?.status) }) }), m.summary ? e("p", { children: m.summary }) : null, m.rationale ? e(
    "p", { className: "task-list-meta", children: m.rationale }) : null] }) : null, Ms ? a("form", { className: "architect-handoff-form", onSubmit: (ge) => {
      oi(ge, t);
    }, children: [a("label", { children: [`Human decision for ${t.task_id}`, a("select", { "aria-label": `Human decision for ${t.task_id}`, value: v.outcome, onChange: (ge) => ht(
    (Tt) => ({ ...Tt, [t.task_id]: { ...v, outcome: ge.target.value } })), children: [e("option", { value: "approve", children: "Approve" }), e("option", { value: "\
reject", children: "Reject" }), e("option", { value: "request_more_context", children: "Request more context" })] })] }), a("label", { children: ["Decision summ\
ary", e("textarea", { "aria-label": `Decision summary for ${t.task_id}`, value: v.summary, onChange: (ge) => ht((Tt) => ({ ...Tt, [t.task_id]: { ...v, summary: ge.
    target.value } })), placeholder: "Short, mobile-scannable decision summary." })] }), a("label", { children: ["Rationale", e("textarea", { "aria-label": `Dec\
ision rationale for ${t.task_id}`, value: v.rationale, onChange: (ge) => ht((Tt) => ({ ...Tt, [t.task_id]: { ...v, rationale: ge.target.value } })), placeholder: "\
Required when rejecting or requesting more context." })] }), a("div", { className: "assignment-form__actions", children: [e("button", { type: "submit", disabled: Z.
    kind === "loading", children: Z.kind === "loading" ? "Recording\u2026" : "Record human decision" }), e("button", { type: "button", className: "button-second\
ary", onClick: () => l(`/tasks/${encodeURIComponent(t.task_id)}`), children: "Open task detail" })] }), Z.kind !== "idle" ? e("p", { className: `assignment-stat\
us assignment-status--${Z.kind}`, role: Z.kind === "error" ? "alert" : "status", children: Z.message }) : null] }) : null] }, t.task_id);
  }) }) : null, ne.kind === "ready" && f && f !== "sre" && f !== "human" && ye.length ? e("div", { className: "task-list-table-wrap", children: a("table", { className: "\
task-list-table", children: [e("thead", { children: a("tr", { children: [e("th", { scope: "col", children: "Task" }), e("th", { scope: "col", children: "Stage" }),
  e("th", { scope: "col", children: "Priority" }), e("th", { scope: "col", children: "Owner" }), e("th", { scope: "col", children: "Queue reason" }), e("th", { scope: "\
col", children: "Routing" })] }) }), e("tbody", { children: ye.map((t) => a("tr", { children: [a("td", { children: [e("a", { href: `/tasks/${encodeURIComponent(
  t.task_id)}`, onClick: (n) => {
    n.preventDefault(), l(`/tasks/${encodeURIComponent(t.task_id)}`);
  }, children: e("strong", { children: t.title || t.task_id }) }), e("div", { className: "task-list-meta", children: t.task_id }), Pt(t) ? e("div", { className: "\
task-list-meta", children: e("span", { className: "routing-badge routing-badge--intake", children: "Intake Draft" }) }) : null] }), e("td", { children: t.current_stage ||
  "\u2014" }), e("td", { children: t.priority || "\u2014" }), a("td", { children: [e("span", { className: `owner-badge owner-badge--${t.ownerPresentation.tone}`,
  children: t.ownerPresentation.label }), e("div", { className: "task-list-meta", children: "Read-only owner metadata" })] }), a("td", { children: [e("span", { className: "\
routing-badge", children: t.queueReason.label }), e("div", { className: "task-list-meta", children: t.queueReason.detail })] }), a("td", { children: [a("span", {
  className: "routing-badge", children: [H(f), " route"] }), e("div", { className: "task-list-meta", children: t.routing.routingLabel })] })] }, t.task_id)) })] }) }) :
  null, P && x.kind === "ready" && xt.length ? e("div", { className: "task-list-table-wrap", children: a("table", { className: "task-list-table", children: [e("\
thead", { children: a("tr", { children: [e("th", { scope: "col", children: "Task" }), e("th", { scope: "col", children: "Stage" }), e("th", { scope: "col", children: "\
Priority" }), e("th", { scope: "col", children: "Owner" })] }) }), e("tbody", { children: xt.map((t) => a("tr", { children: [a("td", { children: [e("a", { href: `\
/tasks/${encodeURIComponent(t.task_id)}`, onClick: (n) => {
    n.preventDefault(), l(`/tasks/${encodeURIComponent(t.task_id)}`);
  }, children: e("strong", { children: t.title || t.task_id }) }), e("div", { className: "task-list-meta", children: t.task_id }), Pt(t) ? e("div", { className: "\
task-list-meta", children: e("span", { className: "routing-badge routing-badge--intake", children: "Intake Draft" }) }) : null] }), e("td", { children: t.current_stage ||
  "\u2014" }), e("td", { children: t.priority || "\u2014" }), a("td", { children: [e("span", { className: `owner-badge owner-badge--${t.ownerPresentation.tone}`,
  children: t.ownerPresentation.label }), e("div", { className: "task-list-meta", children: "Governance-only owner metadata" })] })] }, t.task_id)) })] }) }) : null,
  isCommandCenter ? a("aside", { className: `command-center-inspector${selectedTask ? "" : " command-center-inspector--empty"}`, "aria-label": "Selected task inspector", children: selectedTask ? [a("div", { className: "command-center-inspector__header", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Inspector" }), e("h2", { children: selectedTask.title || selectedTask.task_id })] }), e("button", { type: "button", className: "button-secondary", onClick: () => updateQueueSelection(""), children: "Close" })] }), a("dl", { className: "command-center-inspector__facts", children: [a("div", { children: [e("dt", { children: "Task" }), e("dd", { children: selectedTask.task_id })] }), a("div", { children: [e("dt", { children: "Stage" }), e("dd", { children: selectedTask.current_stage || "\u2014" })] }), a("div", { children: [e("dt", { children: "Priority" }), e("dd", { children: selectedTask.priority || "\u2014" })] }), a("div", { children: [e("dt", { children: "Owner" }), e("dd", { children: e("span", { className: `owner-badge owner-badge--${Li(selectedTask, j).tone}`, children: Li(selectedTask, j).label }) })] })] }), selectedTask.next_required_action ? a("div", { className: "command-center-inspector__note", children: [e("span", { children: "Next action" }), e("p", { children: selectedTask.next_required_action })] }) : null, a("div", { className: "command-center-inspector__actions", children: [e("button", { type: "button", onClick: () => l(`/tasks/${encodeURIComponent(selectedTask.task_id)}`), children: "Open full task detail" }), e("button", { type: "button", className: "button-secondary", onClick: () => updateQueueSelection(""), children: "Return to queue" })] })] : [a("div", { className: "command-center-inspector__header", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Inspector" }), e("h2", { children: "Select a task" })] })] }), e("p", { className: "command-center-inspector__empty-copy", children: "Choose a task from the queue to preview stage, owner, and next action here while keeping queue context visible." })] }) : null,
  x.kind === "ready" && !f && !_ && !P && !A && Ae.length && N.view === "list" ? e("div", { className: "task-list-table-wrap command-center-queue", children: a("table", { className: "\
task-list-table", children: [e("thead", { children: a("tr", { children: [e("th", { scope: "col", children: "Task" }), e("th", { scope: "col", children: "Stage" }),
  e("th", { scope: "col", children: "Priority" }), e("th", { scope: "col", children: "Owner" })] }) }), e("tbody", { children: Ae.map((t) => {
    const n = Li(t, j), r = Mn(t, N.searchTerm), d = Qa(t, h, j);
    return a("tr", { className: `${r ? "task-list-row--match" : ""}${selectedTaskId === t.task_id ? " task-list-row--selected" : ""}`, children: [a("td", { children: [e("a", { href: buildQueueTaskHref(t.task_id), onClick: (m) => {
      m.preventDefault(), updateQueueSelection(t.task_id);
    }, children: e("strong", { children: t.title || t.task_id }) }), e("div", { className: "task-list-meta", children: t.task_id }), Pt(t) ? a("div", { className: "\
task-list-meta", children: [e("span", { className: "routing-badge routing-badge--intake", children: "Intake Draft" }), " ", t.next_required_action || "PM refine\
ment required"] }) : null, t.project ? e("div", { className: "task-list-meta", children: e("a", { href: t.project.href || `/projects/${encodeURIComponent(t.project.projectId)}`, onClick: (m) => { m.preventDefault(), l(`/projects/${encodeURIComponent(t.project.projectId)}`); }, children: t.project.name }) }) : null, d ? e("div", { className: "task-list-meta", children: e("span", { className: "routing-badge", children: "Assigned to me" }) }) : null] }),
    e("td", { children: t.current_stage || "\u2014" }), e("td", { children: t.priority || "\u2014" }), a("td", { children: [e("span", { className: `owner-badge \
owner-badge--${n.tone}`, children: n.label }), e("div", { className: "task-list-meta", children: "Read-only owner metadata" })] })] }, t.task_id);
  }) })] }) }) : null, x.kind === "ready" && !f && !_ && !P && !A && N.view === "board" ? a("div", { className: "task-board command-center-queue", "aria-label": "Task board", children: [
  J.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${J.kind}`, role: J.kind === "error" ? "alert" : "status", children: J.message }) :
  null, e("div", { className: "task-board__scroll", children: e("div", { className: "task-board__columns", children: hi.map((t) => a("section", { className: `ta\
sk-board__column${Yt.overStage === t.stage ? " task-board__column--drop-target" : ""}`, "aria-label": `${t.stageLabel || t.stage} column`, onDragOver: (n) => {
    it(t.stage) && (n.preventDefault(), Yt.overStage !== t.stage && ft((r) => ({ ...r, overStage: t.stage })));
  }, onDragLeave: () => {
    Yt.overStage === t.stage && ft((n) => ({ ...n, overStage: "" }));
  }, onDrop: (n) => {
    n.preventDefault();
    const r = n.dataTransfer.getData("text/task-id"), d = Ae.find((m) => m.task_id === r);
    zs(d, t.stage);
  }, children: [a("div", { className: "task-board__column-header", children: [a("div", { children: [e("h2", { children: t.stageLabel || t.stage }), e("p", { className: "\
task-board__stage-meta", children: t.stageDescription || t.stage })] }), e("span", { children: t.items.length })] }), e("div", { className: "task-board__column-\
body", children: t.items.length ? t.items.map((n) => {
    const r = Mn(n, N.searchTerm), d = Qa(n, h, j);
    return a("article", { className: `task-board__card${r ? " task-board__card--match" : ""}${Yt.taskId === n.task_id ? " task-board__card--dragging" : ""}${selectedTaskId === n.task_id ? " task-board__card--selected" : ""}`, draggable: it(
    n.current_stage), onDragStart: (m) => {
      m.dataTransfer.setData("text/task-id", n.task_id), m.dataTransfer.effectAllowed = "move", ft({ taskId: n.task_id, overStage: "" });
    }, onDragEnd: () => ft({ taskId: null, overStage: "" }), children: [e("a", { href: buildQueueTaskHref(n.task_id), onClick: (m) => {
      m.preventDefault(), updateQueueSelection(n.task_id);
    }, children: e("strong", { children: n.title || n.task_id }) }), e("div", { className: "task-list-meta", children: n.task_id }), n.project ? e("div", { className: "task-list-meta", children: e("a", { href: n.project.href || `/projects/${encodeURIComponent(n.project.projectId)}`, onClick: (m) => { m.preventDefault(), l(`/projects/${encodeURIComponent(n.project.projectId)}`); }, children: n.project.name }) }) : null, Pt(n) ? a("div", { className: "\
task-list-meta", children: [e("span", { className: "routing-badge routing-badge--intake", children: "Intake Draft" }), " ", n.next_required_action || "PM refine\
ment required"] }) : null, t.stage === "VERIFY" || t.stage === "SRE_MONITORING" ? e("div", { className: "task-list-meta", children: e("span", { className: "rout\
ing-badge", children: "SRE review pending" }) }) : null, d ? e("div", { className: "task-list-meta", children: e("span", { className: "routing-badge", children: "\
Assigned to me" }) }) : null, a("div", { className: "task-board__card-meta", children: [e("span", { className: "task-board__label", children: "Priority" }), e("\
span", { children: n.priority || "\u2014" })] }), a("div", { className: "task-board__card-meta task-board__card-meta--owner", children: [e("span", { className: "\
task-board__label", children: "Owner" }), e("span", { className: `owner-badge owner-badge--${n.ownerPresentation.tone} owner-badge--board`, title: n.ownerPresentation.
    label, "aria-label": n.ownerPresentation.detail, children: n.ownerPresentation.label })] }), e("div", { className: "task-list-meta", children: it(n.current_stage) ?
    "Drag to another lifecycle column to move this task." : "Read-only owner metadata" })] }, n.task_id);
  }) : a("p", { className: "task-board__empty", children: ["No matching tasks in this column.", e("span", { className: "task-board__empty-guidance", children: t.
  stageDescription || "No cards match the current filters." })] }) })] }, t.stage)) }) })] }) : null, ne.kind === "ready" && f && !ye.length ? a("div", { className: "\
empty-state", role: "status", children: [a("h2", { children: ["No tasks routed to ", H(f)] }), a("p", { children: ["No assigned tasks currently resolve to the ",
  H(f), " role. This is not a loading state."] }), e("p", { className: "task-list-meta", children: "If owner-to-role mapping is stale or hidden, affected tasks \
remain stable in the general task workspace with safe fallback owner metadata instead of appearing in the wrong inbox." })] }) : null, _ && x.kind === "ready" &&
  !da.length ? a("div", { className: "empty-state", role: "status", children: [e("h2", { children: ae ? `No tasks in ${qn(ae)}` : "No tasks available" }), e("p",
  { children: ae ? "No tasks currently match the selected PM overview bucket." : "No tasks are available in the PM overview yet." }), ae ? e("button", { type: "\
button", onClick: () => l("/overview/pm", we({ bucket: "" }, o)), children: "Clear filter" }) : null] }) : null, P && x.kind === "ready" && !xt.length ? a("div",
  { className: "empty-state", role: "status", children: [e("h2", { children: "No governance reviews available" }), e("p", { children: "No governance review task\
s are currently open." })] }) : null, A && x.kind === "ready" && !Rt.length ? a("div", { className: "empty-state", role: "status", children: [e("h2", { children: "\
No Deferred Considerations awaiting review" }), e("p", { children: "Captured considerations with unresolved status will appear here." })] }) : null, x.kind === "\
ready" && !f && !_ && !P && !A && N.view !== "board" && !Ae.length ? a("div", { className: "empty-state", role: "status", children: [e("h2", { children: N.view ===
  "board" ? "No tasks on the Kanban board" : "No matching tasks" }), e("p", { children: La ? "No tasks match the active task filters." : N.view === "board" ? "N\
o cards are available for this Kanban view yet." : "No tasks are available yet." }), La ? e("button", { type: "button", onClick: () => wt({ owner: "", priority: "",
  status: "", searchTerm: "", project: "" }), children: "Clear all filters" }) : null] }) : null] });
}

export {
  TaskWorkspaceRoute
};
