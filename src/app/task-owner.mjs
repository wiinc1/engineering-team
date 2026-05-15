import { buildBoardStageOrder as w, getBoardStagePresentation as S, matchesTaskSearch as R } from "./work-lifecycle.mjs";
const UNASSIGNED_FILTER_VALUE = "__unassigned__", STAGE_ORDER = ["DRAFT", "BACKLOG", "TODO", "IMPLEMENT", "IMPLEMENTATION", "IN_PROGRESS", "CONTRACT_COVERAGE_AU\
DIT", "REVIEW", "QA_TESTING", "VERIFY", "SRE_MONITORING", "PM_CLOSE_REVIEW", "REOPEN", "DONE"], ROLE_INBOXES = ["pm", "architect", "engineer", "qa", "sre", "hum\
an"], PM_OVERVIEW_BUCKET_ORDER = ["needs-routing-attention", "unassigned", "architect", "engineer", "qa", "sre"];
const g = { P0: 0, P1: 1, P2: 2, P3: 3 }, _ = /* @__PURE__ */ new Set(["IMPLEMENT", "IMPLEMENTATION", "IN_PROGRESS"]), k = { pm: "PM", architect: "Architect", engineer: "\
Engineer", qa: "QA", sre: "SRE", human: "Human Stakeholder" }, E = { "needs-routing-attention": "Needs routing attention", unassigned: "Unassigned", architect: "\
Architect", engineer: "Engineer", qa: "QA", sre: "SRE" }, f = /* @__PURE__ */ new Set(["architect", "engineer", "qa", "sre"]);
function l(e) {
  return String(e?.task_type || "").trim().toLowerCase() === "governance_review";
}
function h(e) {
  const n = String(e || "").trim().toLowerCase();
  return n ? n === "engineer" || n.startsWith("engineer-") ? "engineer" : n === "architect" || n.startsWith("architect-") ? "architect" : n === "qa" || n.startsWith(
  "qa-") ? "qa" : n === "sre" || n.startsWith("sre-") ? "sre" : n === "pm" || n.startsWith("pm-") ? "pm" : null : null;
}
function y(e) {
  switch (String(e || "").trim().toLowerCase()) {
    case "engineer-jr":
      return "Junior Engineer";
    case "engineer-sr":
      return "Senior Engineer";
    case "engineer-principal":
      return "Principal Engineer";
    default:
      return null;
  }
}
function I(e = {}) {
  return !!(e.intake_draft || e.intakeDraft || String(e.current_stage || "").trim().toUpperCase() === "DRAFT");
}
function mapAgentOptions(e = []) {
  return e.map((n) => ({ id: n.id, label: `${n.display_name}${n.role ? ` \xB7 ${n.role}` : ""}`, role: normalizeRoleKey(n.role) }));
}
function normalizeRoleKey(e) {
  if (typeof e != "string") return null;
  const n = e.trim().toLowerCase();
  return n ? n.startsWith("engineer-") ? "engineer" : n.startsWith("architect-") ? "architect" : n.startsWith("qa-") ? "qa" : n.startsWith("sre-") ? "sre" : n.startsWith(
  "pm-") ? "pm" : n === "architecture" ? "architect" : n === "engineering" ? "engineer" : n === "quality assurance" ? "qa" : n === "product" || n === "product m\
anager" ? "pm" : n === "human stakeholder" || n === "stakeholder" ? "human" : ROLE_INBOXES.includes(n) ? n : null : null;
}
function getRoleInboxLabel(e) {
  return k[normalizeRoleKey(e)] || "Role";
}
function d(e) {
  return !e || typeof e != "object" ? false : e.redacted === true || e.visibility === "hidden" || e.policy_state === "hidden";
}
function resolveOwnerPresentation(e, n) {
  if (!e.current_owner) return { label: "Unassigned", detail: "No owner assigned", tone: "unassigned", filterValue: UNASSIGNED_FILTER_VALUE };
  const r = n.get(e.current_owner);
  if (r) return { label: r.label, detail: `Owner: ${r.label}`, tone: "assigned", filterValue: e.current_owner };
  const t = y(e.current_owner);
  return t ? { label: t, detail: `Owner: ${t}`, tone: "assigned", filterValue: e.current_owner } : d(e.owner) ? { label: "Owner hidden", detail: "Owner identity\
 is intentionally redacted on this surface", tone: "fallback", filterValue: e.current_owner } : { label: "Unknown owner", detail: `Owner record unavailable for ${e.
  current_owner}`, tone: "fallback", filterValue: e.current_owner };
}
function resolveRoleInboxMembership(e, n) {
  if (l(e)) return { inboxRole: null, reason: "governance-review", routingLabel: "Operational governance work is intentionally excluded from the delivery inbox \
surfaces.", isFallback: false };
  const r = String(e?.waiting_state || "").trim().toLowerCase(), t = String(e?.next_required_action || "").trim().toLowerCase(), i = e?.close_governance || {}, o = i?.
  humanDecision?.required === true, s = i?.humanDecision?.decisionReady !== false, a = i?.cancellation?.awaitingHumanDecision === true;
  if (I(e)) return { inboxRole: "pm", reason: "intake-draft", routingLabel: "Routed to PM because Intake Drafts require refinement before implementation work st\
arts.", isFallback: false };
  if (r.includes("pm") || t.includes("pm")) return { inboxRole: "pm", reason: "waiting-pm", routingLabel: "Routed to PM because the task is explicitly waiting o\
n PM action.", isFallback: false };
  if (r.includes("architect") || t.includes("architect")) return { inboxRole: "architect", reason: "waiting-architect", routingLabel: "Routed to Architect becau\
se the task is explicitly waiting on architectural review or a tiering decision.", isFallback: false };
  if (o && s || a || r.includes("human") || r.includes("stakeholder") || t.includes("human") || t.includes("stakeholder") || t.includes("approval")) return { inboxRole: "\
human", reason: o && s || a ? "close-governance-human-decision" : "waiting-human", routingLabel: o && s || a ? "Routed to Human Stakeholder because governed clo\
se review is waiting on a human decision rather than routine operational handling." : "Routed to Human Stakeholder because the task is explicitly waiting on hum\
an approval or escalation handling.", isFallback: false };
  if (String(e?.current_stage || "").trim().toUpperCase() === "SRE_MONITORING") return { inboxRole: "sre", reason: "stage-sre-monitoring", routingLabel: "Routed\
 to SRE because the task is actively in the SRE monitoring stage.", isFallback: false };
  if (!e?.current_owner) return { inboxRole: null, reason: "unassigned", routingLabel: "Not routed to a role inbox until an owner is assigned.", isFallback: false };
  const c = n.get(e.current_owner);
  if (c?.role) return { inboxRole: c.role, reason: "matched", routingLabel: `Routed to ${getRoleInboxLabel(c.role)} because the assigned owner maps to that cano\
nical role.`, isFallback: false };
  const u = h(e.current_owner);
  return u ? { inboxRole: u, reason: "matched-pattern", routingLabel: `Routed to ${getRoleInboxLabel(u)} because the assigned owner follows the canonical ${u} o\
wnership pattern.`, isFallback: false } : d(e.owner) ? { inboxRole: null, reason: "hidden", routingLabel: "Owner metadata is intentionally hidden, so role routi\
ng cannot be confirmed on this surface.", isFallback: true } : { inboxRole: null, reason: "unknown-owner", routingLabel: `Assigned owner ${e.current_owner} does\
 not resolve to a canonical role mapping.`, isFallback: true };
}
function getPmOverviewBucketLabel(e) {
  return E[e] || "Unknown bucket";
}
function resolvePmOverviewBucket(e, n) {
  const r = resolveOwnerPresentation(e, n), t = e?.current_owner;
  if (!t) return { key: "unassigned", label: "Unassigned", routingCue: "Unassigned", routingReason: "No owner is assigned, so this task is visible in the Unassi\
gned bucket.", ownerPresentation: r };
  const i = n.get(t), o = h(t);
  return i?.role && f.has(i.role) ? { key: i.role, label: getPmOverviewBucketLabel(i.role), routingCue: `${getRoleInboxLabel(i.role)} route`, routingReason: `Ro\
uted to ${getRoleInboxLabel(i.role)} because the assigned owner maps to that canonical role.`, ownerPresentation: r } : o && f.has(o) ? { key: o, label: getPmOverviewBucketLabel(
  o), routingCue: `${getRoleInboxLabel(o)} route`, routingReason: `Routed to ${getRoleInboxLabel(o)} because the assigned owner follows the canonical ${o} owner\
ship pattern.`, ownerPresentation: r } : i?.role ? { key: "needs-routing-attention", label: "Needs routing attention", routingCue: "Needs routing attention", routingReason: `\
Role mapping unavailable because canonical role ${getRoleInboxLabel(i.role)} is outside the PM overview buckets for this slice.`, ownerPresentation: { ...r, detail: `${r.
  detail}. Role mapping unavailable.` }, degradedLabel: "Role mapping unavailable" } : d(e.owner) ? { key: "needs-routing-attention", label: "Needs routing atte\
ntion", routingCue: "Needs routing attention", routingReason: "Role mapping unavailable because owner metadata is intentionally hidden on this surface.", ownerPresentation: {
  ...r, detail: `${r.detail}. Role mapping unavailable.` }, degradedLabel: "Role mapping unavailable" } : { key: "needs-routing-attention", label: "Needs routin\
g attention", routingCue: "Needs routing attention", routingReason: "Role mapping unavailable because the assigned owner does not resolve to a canonical role ma\
pping.", ownerPresentation: r, degradedLabel: "Role mapping unavailable" };
}
function buildPmOverviewSections(e, n) {
  const r = new Map(PM_OVERVIEW_BUCKET_ORDER.map((t) => [t, []]));
  return e.filter((t) => !l(t)).forEach((t) => {
    const i = resolvePmOverviewBucket(t, n);
    r.get(i.key).push({ ...t, ownerPresentation: i.ownerPresentation, pmBucket: i });
  }), PM_OVERVIEW_BUCKET_ORDER.map((t) => ({ key: t, label: getPmOverviewBucketLabel(t), items: r.get(t) }));
}
function summarizePmOverviewResults(e, n) {
  const r = e.reduce((t, i) => t + i.items.length, 0);
  return n ? `${r} task${r === 1 ? "" : "s"} shown in ${getPmOverviewBucketLabel(n)}.` : `${r} task${r === 1 ? "" : "s"} shown across ${e.filter((t) => t.items.
  length).length} buckets.`;
}
function filterTasksForRoleInbox(e, n, r) {
  const t = normalizeRoleKey(n);
  return e.filter((i) => !l(i) && resolveRoleInboxMembership(i, r).inboxRole === t);
}
function summarizeRoleInboxResults(e, n) {
  const r = getRoleInboxLabel(n);
  return `${e} task${e === 1 ? "" : "s"} routed to ${r}.`;
}
function filterTaskList(e, n) {
  const r = typeof n == "string" ? { owner: n } : { owner: "", priority: "", status: "", searchTerm: "", ...n || {} };
  return e.filter((t) => !(l(t) || r.owner && (r.owner === UNASSIGNED_FILTER_VALUE && t.current_owner || r.owner !== UNASSIGNED_FILTER_VALUE && t.current_owner !==
  r.owner) || r.priority && String(t.priority || "") !== r.priority || r.status && String(t.current_stage || "") !== r.status || r.searchTerm && !R(t, r.searchTerm)));
}
function summarizeListResults(e, n, r, t = "list") {
  const i = t === "board" ? "cards" : "tasks";
  return n ? n === UNASSIGNED_FILTER_VALUE ? `${e} unassigned ${i} shown.` : `${e} ${i} shown for ${r.get(n)?.label || n}.` : `${e} ${i} shown.`;
}
function compareStageName(e, n) {
  const r = STAGE_ORDER.indexOf(e), t = STAGE_ORDER.indexOf(n);
  return r === -1 && t === -1 ? e.localeCompare(n) : r === -1 ? 1 : t === -1 ? -1 : r - t;
}
function buildBoardColumns(e, n, r) {
  const t = new Set(n.map((s) => s.task_id)), i = n.filter((s) => !l(s));
  return w(e).map((s) => {
    const a = S(s);
    return { stage: s, stageLabel: a.label, stageDescription: a.description, stageGroup: a.group, items: i.filter((c) => (c.current_stage || "Unspecified") === s &&
    t.has(c.task_id)).map((c) => ({ ...c, ownerPresentation: resolveOwnerPresentation(c, r) })) };
  });
}
function buildGovernanceReviewItems(e, n) {
  return sortInboxItems(e.filter((r) => l(r))).map((r) => ({ ...r, ownerPresentation: resolveOwnerPresentation(r, n) }));
}
function p(e, n) {
  const r = g[e?.priority] ?? Number.MAX_SAFE_INTEGER, t = g[n?.priority] ?? Number.MAX_SAFE_INTEGER;
  return r !== t ? r - t : 0;
}
function b(e, n) {
  const r = Date.parse(e?.freshness?.last_updated_at || "") || 0, t = Date.parse(n?.freshness?.last_updated_at || "") || 0;
  return r !== t ? r - t : 0;
}
function m(e, n) {
  return String(e?.task_id || "").localeCompare(String(n?.task_id || ""));
}
function v(e, n) {
  const r = Number(e?.monitoring?.timeRemainingMs), t = Number(n?.monitoring?.timeRemainingMs), i = Number.isFinite(r) ? r : Number.MAX_SAFE_INTEGER, o = Number.
  isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  return i !== o ? i - o : 0;
}
function sortInboxItems(e = [], n = null) {
  const r = normalizeRoleKey(n);
  return [...e].sort((t, i) => r === "sre" ? p(t, i) || v(t, i) || b(t, i) || m(t, i) : p(t, i) || b(t, i) || m(t, i));
}
function resolveQueueReason(e, n) {
  const r = normalizeRoleKey(n), t = e?.priority || "Unprioritized", i = _.has(e?.current_stage || ""), o = e?.next_required_action || null, s = e?.queue_entered_at ||
  e?.freshness?.last_updated_at || null, a = e?.close_governance || null, c = a?.escalation?.summary || a?.escalation?.recommendation || null, u = a?.humanDecision?.
  summary || a?.latestDecision?.summary || null;
  return I(e) && r === "pm" ? { label: o || "PM refinement required", detail: `Intake Draft awaiting PM refinement before implementation work can start. Ordered\
 by queue age (${s || "unknown"}) and task ID.` } : r === "human" && (a?.humanDecision?.required && a?.humanDecision?.decisionReady !== false || a?.cancellation?.
  awaitingHumanDecision) ? { label: u || c || "Human decision required", detail: `Decision-ready close governance item. Ordered by priority first, then queue ag\
e (${s || "unknown"}), then task ID for stable tie-breaking.` } : o ? { label: o, detail: `Action needed from ${getRoleInboxLabel(r)}. Ordered by priority first\
, then queue age (${s || "unknown"}), then task ID for stable tie-breaking.` } : r === "sre" && e?.monitoring?.windowEndsAt ? { label: e.monitoring.state === "a\
pproved" ? "Monitoring approved" : e.monitoring.state === "escalated" ? "Escalated to human review" : `Monitoring window: ${e.monitoring.timeRemainingLabel || "\
unknown"}`, detail: `Operational review is ordered by priority first, then remaining monitoring time (${e.monitoring.windowEndsAt}), then freshness, then task I\
D.` } : i ? { label: "Active work retained", detail: `${t} task already in progress. Higher-priority queued work should not automatically preempt active work.` } :
  { label: `${t} waiting work`, detail: `Waiting for ${getRoleInboxLabel(r)} action. Ordered by priority first, then queue age (${s || "unknown"}), then task ID\
 for stable tie-breaking.` };
}
function buildRoleInboxItems(e, n, r) {
  return sortInboxItems(filterTasksForRoleInbox(e, n, r), n).map((t) => ({ ...t, ownerPresentation: resolveOwnerPresentation(t, r), routing: resolveRoleInboxMembership(
  t, r), queueReason: resolveQueueReason(t, n) }));
}
export {
  PM_OVERVIEW_BUCKET_ORDER,
  ROLE_INBOXES,
  STAGE_ORDER,
  UNASSIGNED_FILTER_VALUE,
  buildBoardColumns,
  buildGovernanceReviewItems,
  buildPmOverviewSections,
  buildRoleInboxItems,
  compareStageName,
  filterTaskList,
  filterTasksForRoleInbox,
  getPmOverviewBucketLabel,
  getRoleInboxLabel,
  mapAgentOptions,
  normalizeRoleKey,
  resolveOwnerPresentation,
  resolvePmOverviewBucket,
  resolveQueueReason,
  resolveRoleInboxMembership,
  sortInboxItems,
  summarizeListResults,
  summarizePmOverviewResults,
  summarizeRoleInboxResults
};
