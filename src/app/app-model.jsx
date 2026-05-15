import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";
import c from "react";
import { sanitizeNextRoute as Pn, writeBrowserSessionConfig as Ga } from "./session.browser";
import { getRoleInboxLabel as H } from "./task-owner.mjs";

const At = (import.meta.env.VITE_TASK_API_BASE_URL || "").trim(), Wi = /^[0-9a-f]{7,40}$/i, ji = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:\/?\S*)?$/i,
On = [{ value: "question", label: "Question" }, { value: "escalation", label: "Escalation" }, { value: "consultation", label: "Consultation" }, { value: "decisi\
on", label: "Decision" }, { value: "note", label: "Note" }], Vi = { pm: "PM", architect: "Architect", engineer: "Engineer", qa: "QA", sre: "SRE", followers: "Fo\
llowers" }, ot = "/sign-in", Ki = "/auth/callback", Ji = "/admin/users", Yi = 5e3;
function Ln(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === ot;
}
function pa(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === Ki;
}
function isEmailVerificationRoute(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/auth/email/verify";
}
function isPasswordResetRoute(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/auth/password-reset";
}
function readAuthTokenFromSearch(i = "") {
  return new URLSearchParams(i).get("token") || "";
}
function ga(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === Ji;
}
function Xi(i = "") {
  const o = (i || "").replace(/\/+$/, "") || "/";
  return o === "/" || za(o) || Hn(o) || !!Ie(o) || ga(o) || !!De(o) || !!Pe(o) || !!qe(o) || !!Fa(o);
}
function It(i = "/tasks", o = "") {
  const l = new URLSearchParams(), u = Pn(i);
  u && u !== "/tasks" && l.set("next", u), o && l.set("reason", o);
  const b = l.toString();
  return b ? `?${b}` : "";
}
function Zi(i = "") {
  const o = new URLSearchParams(i);
  return { next: Pn(o.get("next") || "/tasks"), reason: o.get("reason") || "" };
}
function eo(i = "") {
  return { apiBaseUrl: i, authCode: "", email: "", password: "", registrationEmail: "", registrationPassword: "", displayName: "", inviteCode: "", resetEmail: "",
  resetPassword: "" };
}
function authModeFromSearch(i = "") {
  const o = new URLSearchParams(i).get("mode");
  return o === "register" ? "register" : o === "reset" || o === "resetRequest" ? "resetRequest" : "signIn";
}
function authSearchWithMode(i = "", o = "signIn") {
  const l = new URLSearchParams(i);
  o === "signIn" ? l.delete("mode") : l.set("mode", o === "resetRequest" ? "reset" : o);
  const u = l.toString();
  return u ? "?" + u : "";
}
function AuthPasswordField({ id: i, name: o, label: l, value: u, onChange: b, autoComplete: S, visible: C, onToggle: y, hint: E }) {
  return a("div", { className: "auth-field auth-password-field", children: [e("label", { htmlFor: i, children: l }), a("div", { className: "auth-password-input",
  children: [e("input", { id: i, name: o, type: C ? "text" : "password", value: u, onChange: b, autoComplete: S, spellCheck: false, autoCapitalize: "none", "ari\
a-describedby": E ? i + "-hint" : void 0 }), e("button", { type: "button", className: "auth-password-toggle", onClick: y, "aria-label": (C ? "Hide " : "Show ") +
  String(l || "password").toLowerCase(), "aria-controls": i, children: C ? "Hide" : "Show" })] }), E ? e("p", { id: i + "-hint", className: "auth-field-hint", children: E }) :
  null] });
}
function to(i = "") {
  switch (String(i || "").trim()) {
    case "expired":
      return "Your session expired. Sign in again to continue.";
    case "signed_out":
      return "You signed out of Engineering Team.";
    case "magic_link_removed":
      return "Magic-link sign-in has been removed. Sign in with your email and password.";
    case "expired_magic_link":
    case "invalid_magic_link":
    case "replayed_magic_link":
    case "magic_link_failed":
      return "That sign-in link could not be used. Sign in with your email and password.";
    default:
      return "";
  }
}
function ao(i, o) {
  return Ga({ bearerToken: i?.accessToken || "", apiBaseUrl: o, expiresAt: i?.expiresAt || "" });
}
async function no({ apiBaseUrl: i, authCode: o, fetchImpl: l = window.fetch.bind(window) }) {
  const u = new AbortController(), b = window.setTimeout(() => u.abort(), Yi);
  try {
    const S = await l(`${i}/auth/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authCode: o }), signal: u.signal }),
    C = await S.json();
    if (!S.ok) throw new Error(C?.error?.message || "Sign-in failed.");
    return C?.data || {};
  } catch (S) {
    throw S?.name === "AbortError" ? new Error("Sign-in timed out. Try again.") : S;
  } finally {
    window.clearTimeout(b);
  }
}
function Fa(i) {
  const o = ((i || "").replace(/\/+$/, "") || "/").match(/^\/tasks\/([^/]+)$/);
  return o ? { taskId: decodeURIComponent(o[1]) } : null;
}
function za(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/tasks";
}
function Hn(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/tasks/create";
}
function Ie(i = "") {
  const l = ((i || "").replace(/\/+$/, "") || "/").match(/^\/inbox\/(pm|architect|engineer|qa|sre|human)$/);
  return l ? { role: l[1] } : null;
}
function De(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/overview/pm" ? { scope: "pm" } : null;
}
function Pe(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/overview/governance" ? { scope: "governance" } : null;
}
function qe(i = "") {
  return ((i || "").replace(/\/+$/, "") || "/") === "/deferred-considerations" ? { scope: "deferred-considerations" } : null;
}
function va(i = "") {
  const o = new URLSearchParams(i), l = o.get("owner") || "", u = o.get("view") === "list" ? "list" : "board", b = o.get("bucket") || "", S = o.get("priority") ||
  "", C = o.get("status") || "", y = o.get("search") || "";
  return { owner: l, view: u, bucket: b, priority: S, status: C, searchTerm: y };
}
function we({ owner: i, view: o, bucket: l, priority: u, status: b, searchTerm: S }, C = "") {
  const y = new URLSearchParams(C), E = i ?? y.get("owner") ?? "", M = o ?? (y.get("view") === "list" ? "list" : "board"), V = l ?? y.get("bucket") ?? "", se = u ??
  y.get("priority") ?? "", s = b ?? y.get("status") ?? "", O = S ?? y.get("search") ?? "";
  E ? y.set("owner", E) : y.delete("owner"), M === "list" ? y.set("view", "list") : o === "board" || y.get("view") === "board" ? y.set("view", "board") : y.delete(
  "view"), V ? y.set("bucket", V) : y.delete("bucket"), se ? y.set("priority", se) : y.delete("priority"), s ? y.set("status", s) : y.delete("status"), O ? y.set(
  "search", O) : y.delete("search");
  const Ne = y.toString();
  return Ne ? `?${Ne}` : "";
}
function Wa(i, o) {
  const l = Fa(i);
  return { kind: "detail", route: l ? { pathname: `/tasks/${encodeURIComponent(l.taskId)}`, taskId: l.taskId } : { pathname: i, taskId: null }, summary: { taskId: l?.
  taskId ?? null, tenantId: null, title: "Loading task detail\u2026", priority: null, currentStage: null, currentOwner: null, blocked: false, waitingState: null,
  nextRequiredAction: null, freshness: null, statusIndicator: "unknown", closed: false }, shell: { selectedTab: new URLSearchParams(o).get("tab") === "telemetry" ?
  "telemetry" : "history", filters: {}, historyState: { kind: "loading", message: "Loading task history." }, telemetryState: { kind: "loading", message: "Loadin\
g task telemetry." }, historyItems: [], telemetryCards: [], historyPageInfo: null, telemetryAccess: null } };
}
function ja(i, o) {
  const l = Ie(i), u = De(i), b = Pe(i), S = qe(i);
  return { kind: "list", route: { pathname: l ? `/inbox/${l.role}` : u ? "/overview/pm" : b ? "/overview/governance" : S ? "/deferred-considerations" : "/tasks",
  taskId: null }, list: { filters: va(o), items: [], state: { kind: "loading", message: l ? `Loading ${H(l.role)} inbox.` : u ? "Loading PM overview." : b ? "Lo\
ading governance reviews." : S ? "Loading Deferred Considerations." : "Loading task workspace." }, resultSummary: "", inboxRole: l?.role || null, isPmOverview: !!u,
  isGovernanceOverview: !!b, isDeferredConsiderations: !!S } };
}
function so(i) {
  return !!Fa(i);
}
function Dt(i) {
  return { kind: "detail", route: { pathname: i, taskId: null }, summary: { taskId: null, tenantId: null, title: "Task detail route not found", priority: null, currentStage: null,
  currentOwner: null, blocked: false, waitingState: null, nextRequiredAction: null, freshness: null, statusIndicator: "unknown", closed: false }, shell: { selectedTab: "\
history", filters: {}, historyState: { kind: "error", message: "Open a task detail route like /tasks/TSK-42." }, telemetryState: { kind: "error", message: "Open\
 a task detail route like /tasks/TSK-42." }, historyItems: [], telemetryCards: [], historyPageInfo: null, telemetryAccess: null } };
}
function io(i) {
  return i?.freshness?.last_updated_at ? `${i.freshness.status || "unknown"} \xB7 ${i.freshness.last_updated_at}` : "\u2014";
}
function rt(i) {
  switch (i) {
    case "blocked":
      return "Blocked";
    case "waiting":
      return "Waiting";
    case "done":
      return "Done";
    default:
      return "Active";
  }
}
function oo(i, o) {
  return i?.label ? i.label : o === "blocked" ? "Blocked" : o === "waiting" ? "Waiting" : "Active";
}
function Gn(i = []) {
  return i.map((o) => o === "stage_transitions" ? "Stage changes paused" : o === "closure" ? "Closure paused" : String(o || "").trim()).filter(Boolean);
}
function ro(i = {}) {
  return [i.source ? `Source: ${i.source}` : null, i.owner?.label ? `Owner: ${i.owner.label}` : "Owner: No owner", i.ageLabel ? `Age: ${i.ageLabel}` : null].filter(
  Boolean).join(" \xB7 ");
}
function Qn(i) {
  switch (i) {
    case "answered":
      return "Answered, awaiting PM resolution";
    case "resolved":
      return "Resolved";
    default:
      return "Open, awaiting PM response";
  }
}
function lo(i) {
  switch (i) {
    case "blocked":
      return "\u26D4";
    case "waiting":
      return "\u23F3";
    case "done":
      return "\u2705";
    default:
      return "\u25B6";
  }
}
function Pt(i = {}) {
  return !!(i.intake_draft || i.intakeDraft || i.context?.intakeDraft || String(i.current_stage || i.currentStage || i.task?.stage || "").trim().toUpperCase() ===
  "DRAFT");
}
function co(i) {
  switch (i) {
    case "ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    case "missing":
      return "Missing";
    default:
      return "Pending";
  }
}
function uo(i) {
  switch (i) {
    case "ready":
      return "Close readiness satisfied";
    case "blocked":
      return "Close readiness blocked";
    case "missing_inputs":
      return "Close readiness missing inputs";
    default:
      return "Close readiness pending";
  }
}
function Va(i) {
  switch (i) {
    case "approved":
      return "Human decision approved";
    case "rejected":
      return "Human decision rejected";
    case "requested_more_context":
      return "Human decision requested more context";
    case "awaiting_decision":
      return "Awaiting human decision";
    default:
      return "Human decision not required";
  }
}
function mo(i) {
  switch (i) {
    case "ready":
      return "Ready";
    case "running":
      return "Running";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Fallback";
    case "completed":
      return "Completed";
    default:
      return "Unknown";
  }
}
function po(i) {
  switch (i) {
    case "ready":
      return "Ready to dispatch";
    case "in_progress":
      return "Already in progress";
    case "blocked":
      return "Blocked by dependency";
    case "done":
      return "Done";
    default:
      return "Unknown";
  }
}
function Fn(i = {}) {
  return { readyForEngineering: !!i.readyForEngineering, engineerTier: i.engineerTier || "Sr", tierRationale: i.tierRationale || "", technicalSpec: { summary: i.
  technicalSpec?.summary || "", scope: i.technicalSpec?.scope || "", design: i.technicalSpec?.design || "", rolloutPlan: i.technicalSpec?.rolloutPlan || "" }, monitoringSpec: {
  service: i.monitoringSpec?.service || "", dashboardUrls: Array.isArray(i.monitoringSpec?.dashboardUrls) ? i.monitoringSpec.dashboardUrls.join(`
`) : "", alertPolicies: Array.isArray(i.monitoringSpec?.alertPolicies) ? i.monitoringSpec.alertPolicies.join(`
`) : "", runbook: i.monitoringSpec?.runbook || "", successMetrics: Array.isArray(i.monitoringSpec?.successMetrics) ? i.monitoringSpec.successMetrics.join(`
`) : "" } };
}
function zn(i) {
  switch (i) {
    case "Principal":
      return "Complex cross-team implementation with high-risk technical ownership.";
    case "Jr":
      return "Well-bounded implementation with close guidance and review.";
    default:
      return "Standard implementation scope with experienced engineer ownership.";
  }
}
function Wn(i = {}) {
  return { commitSha: i.commitSha || "", prUrl: i.prUrl || "" };
}
function jn(i = {}) {
  return { reason: i.reason || "" };
}
function Vn(i = {}) {
  return { summary: i.lastActivity?.summary || "", evidence: Array.isArray(i.lastActivity?.evidence) ? i.lastActivity.evidence.join(`
`) : "" };
}
function Kn(i = {}) {
  return { engineerTier: i.retiering?.engineerTier || i.architectHandoff?.engineerTier || "Sr", tierRationale: i.retiering?.tierRationale || "", reason: i.retiering?.
  reason || "" };
}
function Jn(i = {}) {
  return { mode: i.reassignment?.mode || "inactivity", reason: i.reassignment?.reason || "", assignee: i.reassignment?.assignee || "", engineerTier: i.reassignment?.
  engineerTier || i.retiering?.engineerTier || i.architectHandoff?.engineerTier || "" };
}
function go(i = {}) {
  const o = String(i.commitSha || "").trim(), l = String(i.prUrl || "").trim(), u = [];
  return o && !Wi.test(o) && u.push("commitSha"), l && !ji.test(l) && u.push("prUrl"), { commitSha: o, prUrl: l, missingAll: !o && !l, invalidFields: u, isValid: u.
  length === 0 && (!!o || !!l), primaryReference: l || o || null };
}
function Yn(i = {}) {
  return { commentType: i.commentType || "question", title: i.title || "", body: i.body || "", blocking: !!i.blocking, linkedEventId: i.linkedEventId || "" };
}
function Xn(i = {}) {
  return { outcome: i.outcome || "fail", summary: i.summary || "", scenarios: Array.isArray(i.scenarios) ? i.scenarios.join(`
`) : "", findings: Array.isArray(i.findings) ? i.findings.join(`
`) : "", reproductionSteps: Array.isArray(i.reproductionSteps) ? i.reproductionSteps.join(`
`) : "", stackTraces: Array.isArray(i.stackTraces) ? i.stackTraces.join(`
`) : "", envLogs: Array.isArray(i.envLogs) ? i.envLogs.join(`
`) : "", retestScope: Array.isArray(i.reTestScope) ? i.reTestScope.join(`
`) : "" };
}
function Zn(i = {}) {
  return { deploymentEnvironment: i.deployment?.environment || "production", deploymentUrl: i.deployment?.url || "", deploymentVersion: i.deployment?.version ||
  "", evidence: Array.isArray(i.deployment?.evidence) ? i.deployment.evidence.join(`
`) : "" };
}
function es(i = {}) {
  return { reason: i.approval?.reason || "", evidence: Array.isArray(i.approval?.evidence) ? i.approval.evidence.join(`
`) : "" };
}
function ts(i = {}) {
  const o = i?.context?.sreMonitoring || {}, l = i?.telemetry?.summary || {}, u = i?.context?.anomalyChildTask || {}, b = u.prefill || {}, S = Object.entries(l).
  find(([, V]) => V != null && V !== ""), C = S ? `${S[0]}: ${String(S[1])}` : "", y = o.telemetry?.drilldowns?.logs || "", E = o.telemetry?.drilldowns?.metrics ||
  "", M = o.telemetry?.drilldowns?.traces || "";
  return { title: u.summary ? `Investigate ${u.service || "production"} anomaly for ${i?.task?.id || "task"}` : `Investigate ${o.architectMonitoringSpec?.service ||
  "production"} anomaly for ${i?.task?.id || "task"}`, service: u.service || b.service || o.architectMonitoringSpec?.service || "", anomalySummary: u.summary ||
  b.anomalySummary || (i?.summary?.nextAction?.label ? `Follow up on ${i.summary.nextAction.label.toLowerCase()}.` : ""), metrics: u.metrics?.length ? u.metrics.
  join(`
`) : Array.isArray(b.metrics) && b.metrics.length ? b.metrics.join(`
`) : C, logs: u.logs?.length ? u.logs.join(`
`) : Array.isArray(b.logs) && b.logs.length ? b.logs.join(`
`) : y, errorSamples: u.errorSamples?.length ? u.errorSamples.join(`
`) : Array.isArray(b.errorSamples) && b.errorSamples.length ? b.errorSamples.join(`
`) : [E, M].filter(Boolean).join(`
`) };
}
function as(i = {}) {
  return { businessContext: i?.context?.businessContext || "" };
}
function ns(i = {}) {
  const o = i?.context?.closeGovernance?.cancellation?.recommendations?.pm || i?.context?.closeGovernance?.cancellation?.recommendations?.architect || null;
  return { summary: o?.summary || "", rationale: o?.rationale || "" };
}
function ss(i = {}) {
  const o = i?.context?.closeGovernance?.escalation || null;
  return { summary: o?.summary || "", rationale: o?.rationale || "", recommendation: o?.recommendation || "", severity: o?.severity || "high" };
}
function is(i = {}) {
  const o = i?.context?.closeGovernance?.humanDecision?.latestDecision || null;
  return { outcome: o?.outcome || "approve", summary: o?.summary || "", rationale: o?.rationale || "" };
}
function os(i = {}) {
  const o = i?.close_governance?.humanDecision?.latestDecision || null;
  return { outcome: o?.outcome || "approve", summary: o?.summary || "", rationale: o?.rationale || "" };
}
function rs(i = {}) {
  const o = i?.context?.closeGovernance?.backtrack || {};
  return { reasonCode: o?.latestReasonCode || "criteria_gap", rationale: o?.latestReason || "", agreementArtifact: "", summary: "" };
}
function Ka() {
  return { title: "", knownContext: "", rationale: "", sourceSection: "", sourceComment: "", sourceAgent: "", owner: "pm", revisitTrigger: "", revisitDate: "", openQuestions: "" };
}
function ka(i = {}) {
  return { reviewNote: "", revisitTrigger: i.revisit_trigger || "", revisitDate: i.revisit_date || "", promotionTitle: i.title || "", promotionNote: "", closeRationale: "" };
}
function vo(i = []) {
  return i.reduce((o, l) => {
    const u = l.id || l.deferred_consideration_id;
    return u && (o[u] = ka(l)), o;
  }, {});
}
function Ja(i) {
  switch (i) {
    case "reviewed":
      return "Reviewed";
    case "promoted":
      return "Promoted";
    case "closed_no_action":
      return "Closed no action";
    default:
      return "Captured";
  }
}
function ko(i = []) {
  return i.flatMap((o) => (o?.deferred_considerations?.unresolved || o?.deferredConsiderations?.unresolved || []).map((u) => ({ ...u, task: o, sourceTaskId: o.task_id ||
  o.taskId, sourceTaskTitle: o.title || o.task_id || o.taskId }))).sort((o, l) => {
    const u = o.revisit_date || o.reviewed_at || o.captured_at || "", b = l.revisit_date || l.reviewed_at || l.captured_at || "";
    return String(u).localeCompare(String(b));
  });
}
function ho(i = {}) {
  return i.revisit_date ? { key: `date:${i.revisit_date}`, label: `Revisit date: ${i.revisit_date}` } : i.revisit_trigger ? { key: `trigger:${i.revisit_trigger}`,
  label: `Trigger: ${i.revisit_trigger}` } : { key: `source:${i.sourceTaskId || "unknown"}`, label: `Source task: ${i.sourceTaskId || "Unknown task"}` };
}
function bo(i = []) {
  const o = /* @__PURE__ */ new Map();
  for (const l of i) {
    const u = ho(l);
    o.has(u.key) || o.set(u.key, { ...u, items: [] }), o.get(u.key).items.push(l);
  }
  return [...o.values()];
}
function B(i) {
  return String(i || "").split(/\n+/).map((o) => o.trim()).filter(Boolean);
}
function ls(i) {
  const o = On.find((l) => l.value === i);
  return o ? o.label : "Note";
}
function cs(i, o) {
  switch (i) {
    case "question":
      return o ? ["pm", "architect"] : ["architect"];
    case "escalation":
      return ["pm", "engineer", "sre"];
    case "consultation":
      return ["architect", "engineer"];
    case "decision":
      return ["pm", "architect", "engineer", "qa"];
    default:
      return o ? ["pm", "architect"] : ["followers"];
  }
}
function ds(i) {
  return Vi[i] || String(i || "").trim() || "Unknown";
}
function fo(i = {}) {
  return i.outcome !== "fail" ? [] : [["scenarios", B(i.scenarios)], ["findings", B(i.findings)], ["reproduction steps", B(i.reproductionSteps)], ["stack traces",
  B(i.stackTraces)], ["environment logs", B(i.envLogs)]].filter(([, l]) => l.length === 0).map(([l]) => l);
}
function yo(i) {
  return ["IMPLEMENT", "IMPLEMENTATION", "IN_PROGRESS"].includes(String(i || "").toUpperCase());
}
function F(i, o) {
  return !i || !i.length ? e("p", { className: "empty-copy", children: o }) : e("ul", { className: "detail-bullets", children: i.map((l, u) => e("li", { children: l },
  `${l}-${u}`)) });
}
function Ya(i) {
  const o = Array.isArray(i?.roles) ? i.roles : [];
  return o.includes("pm") || o.includes("admin");
}
function I(i, o) {
  const l = (Array.isArray(i?.roles) ? i.roles : []).map((b) => String(b || "").trim().toLowerCase()).filter(Boolean).map((b) => b === "stakeholder" ? "human" :
  b);
  return o.map((b) => String(b || "").trim().toLowerCase()).filter(Boolean).map((b) => b === "stakeholder" ? "human" : b).some((b) => l.includes(b));
}
function Xa(i) {
  return (Array.isArray(i) ? i : String(i || "").split(",")).map((l) => String(l || "").trim()).filter(Boolean);
}
const AUTH_USER_STATUS_OPTIONS = Object.freeze([{ value: "active", label: "active" }, { value: "pending_approval", label: "pending approval" }, { value: "pendin\
g_verification", label: "pending verification" }, { value: "invited", label: "invited" }, { value: "disabled", label: "disabled" }]), AUTH_USER_STATUS_VALUES = new Set(
AUTH_USER_STATUS_OPTIONS.map((i) => i.value));
function normalizeAuthUserStatus(i, o = "active") {
  const l = String(i || o).trim().toLowerCase();
  return AUTH_USER_STATUS_VALUES.has(l) ? l : o;
}
function Za(i = {}) {
  return { tenantId: i.tenantId || "", actorId: i.actorId || "", roles: Xa(i.roles).join(", "), status: normalizeAuthUserStatus(i.status) };
}
function wo(i = []) {
  return i.reduce((o, l) => (l?.userId && (o[l.userId] = Za(l)), o), {});
}
function No(i) {
  return I(i, ["architect", "admin"]);
}
function us(i) {
  return I(i, ["architect", "admin"]);
}
function ms(i) {
  return I(i, ["engineer", "admin"]);
}
function Co(i) {
  return I(i, ["engineer", "admin"]);
}
function So(i) {
  return I(i, ["architect", "admin"]);
}
function _o(i) {
  return I(i, ["sre", "admin"]);
}
function xo(i) {
  return I(i, ["pm", "admin"]);
}
function Ro(i) {
  return I(i, ["pm", "admin"]);
}
function To(i) {
  return I(i, ["pm", "admin"]);
}
function Ao(i) {
  return I(i, ["architect", "pm", "admin"]);
}
function ps(i) {
  return I(i, ["pm", "architect", "admin"]);
}
function gs(i) {
  return I(i, ["human", "stakeholder", "admin"]);
}
function Io(i) {
  return I(i, ["pm", "architect", "admin"]);
}
function Do(i) {
  return I(i, ["pm", "admin"]);
}
function Po(i) {
  return I(i, ["pm", "human", "stakeholder", "operator", "admin"]);
}
function qo(i) {
  return i?.context?.retiering?.engineerTier || i?.context?.architectHandoff?.engineerTier || null;
}
function Eo(i) {
  switch (i) {
    case "task.review_question_asked":
      return "Question asked";
    case "task.review_question_answered":
      return "Answer recorded";
    case "task.review_question_resolved":
      return "Resolved";
    case "task.review_question_reopened":
      return "Reopened";
    default:
      return "Update recorded";
  }
}
function Uo() {
  const [i, o] = c.useState(() => ({ pathname: window.location.pathname, search: window.location.search }));
  c.useEffect(() => {
    const u = () => {
      o({ pathname: window.location.pathname, search: window.location.search });
    };
    return window.addEventListener("popstate", u), () => window.removeEventListener("popstate", u);
  }, []);
  const l = c.useCallback((u, b = "", S = {}) => {
    const C = `${u}${b}`;
    S.replace ? window.history.replaceState({}, "", C) : window.history.pushState({}, "", C), o({ pathname: u, search: b });
  }, []);
  return [i, l];
}
function readNavPanelOpen() {
  try {
    const i = window.localStorage?.getItem("engineering-team-nav-open");
    if (i === "true") return true;
    if (i === "false") return false;
    return !window.matchMedia?.("(max-width: 800px)")?.matches;
  } catch {
    return true;
  }
}
function writeNavPanelOpen(i) {
  try {
    window.localStorage?.setItem("engineering-team-nav-open", String(i));
  } catch {
  }
}

export {
  _o,
  ao,
  Ao,
  as,
  At,
  AUTH_USER_STATUS_OPTIONS,
  AUTH_USER_STATUS_VALUES,
  authModeFromSearch,
  AuthPasswordField,
  authSearchWithMode,
  B,
  bo,
  co,
  Co,
  cs,
  De,
  Do,
  ds,
  Dt,
  eo,
  Eo,
  es,
  F,
  Fa,
  Fn,
  fo,
  ga,
  Gn,
  go,
  gs,
  Hn,
  ho,
  I,
  Ie,
  io,
  Io,
  is,
  isEmailVerificationRoute,
  isPasswordResetRoute,
  It,
  ja,
  Ja,
  ji,
  Ji,
  jn,
  Jn,
  ka,
  Ka,
  Ki,
  Kn,
  ko,
  Ln,
  lo,
  ls,
  mo,
  ms,
  no,
  No,
  normalizeAuthUserStatus,
  ns,
  On,
  oo,
  os,
  ot,
  pa,
  Pe,
  po,
  Po,
  ps,
  Pt,
  qe,
  Qn,
  qo,
  readAuthTokenFromSearch,
  readNavPanelOpen,
  ro,
  Ro,
  rs,
  rt,
  so,
  So,
  ss,
  to,
  To,
  ts,
  uo,
  Uo,
  us,
  va,
  Va,
  Vi,
  Vn,
  vo,
  Wa,
  we,
  Wi,
  Wn,
  wo,
  writeNavPanelOpen,
  Xa,
  Xi,
  Xn,
  xo,
  Ya,
  Yi,
  Yn,
  yo,
  za,
  Za,
  Zi,
  zn,
  Zn
};
