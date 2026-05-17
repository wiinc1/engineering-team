import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";
import { LiveTaskFreshnessIndicator, useLiveTaskFreshnessPolling } from "../live-task-freshness";
import { TaskDetailNextActionPanel } from "../../features/task-detail/TaskDetailNextActionPanel";

function TaskDetailRoute({ ctx }) {
  const {
    _a, _n, _s, _t, $, $a, $e, $s,
    aa, ai, an, As, At, B, ba, Ba, be,
    Be, Bn, Bs, bt, Bt, Ca, ce, Ci,
    Cn, co, cs, Cs, ct, de, ds, dt,
    ee, Ee, ei, en, Eo, Es, et, Et,
    F, fa, fe, Fe, Fs, g, G, Ge,
    Gn, Gs, gt, h, He, hs, ia, ie,
    ii, io, Is, it, j, J, Ja, je,
    Je, js, Js, jt, k, K, ka, Ke,
    ks, Ks, kt, l, L, la, le, Le,
    ln, lo, ls, Ls, me, Me, mo, mt,
    Mt, na, Na, Ne, ni, Ni, nn, Nn,
    Ns, Nt, o, oa, oe, Oe, On, oo,
    Os, p, Pa, pe, pn, po, Ps, pt,
    Q, qa, Qe, Qn, qs, Qs, R, ra,
    Ra, re, Re, ri, rn, Rn, ro, Rs,
    rt, s, Sa, Se, si, sn, Sn, st,
    St, T, ta, Ta, te, ti, tn, Ts,
    u, U, Ua, Ue, un, uo, Us, ut, Ut,
    Va, ve, Ve, vn, vs, Vs, vt, w,
    wa, we, We, wn, Ws, xe, Xe, xn,
    xs, Xs, ya, Ye, yn, Ys, z, ze,
    Ze, zn, Zs } = ctx;
  const liveFreshness = useLiveTaskFreshnessPolling({ session: u, defaultBaseUrl: At, scope: { kind: "detail", taskId: g }, onUpdates: k });
  return a(q, { children: [new URLSearchParams(o).get("created") === "intake-dr\
aft" ? a("section", { className: "task-created-banner", role: "status", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Task created" }),
  e("h2", { children: "Intake Draft is ready for PM refinement" }), e("p", { children: "This task keeps the same ID through refinement, implementation, verifica\
tion, and closeout." })] }), e("button", { type: "button", className: "button-secondary", onClick: () => l("/tasks", we({ view: "board" }, "")), children: "Back\
 to task workspace" })] }) : null, s.detail?.reviewQuestions?.pinned?.length ? a("section", { className: "review-question-banner", "aria-label": "Architect revi\
ew blockers", role: "alert", "aria-live": "assertive", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Architect review blockers" }),
  e("h2", { children: "Pending PM answers are blocking architect review" }), e("p", { className: "review-question-banner__lede", children: "These workflow threa\
ds stay pinned until PM resolves every blocking architect review question." })] }), e("ul", { className: "review-question-list", children: s.detail.reviewQuestions.
  pinned.map((t) => a("li", { children: [e("strong", { children: t.prompt }), e("span", { children: Qn(t.state) })] }, t.id)) })] }) : null, ta.filter((t) => t.
  blocking && t.state !== "resolved").length ? a("section", { className: "review-question-banner", "aria-label": "Workflow thread blockers", role: "alert", "ari\
a-live": "assertive", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Workflow blockers" }), e("h2", { children: "Blocking workflow t\
hreads need resolution" }), e("p", { className: "review-question-banner__lede", children: "Blocking questions, escalations, decisions, and consultations stay pi\
nned here until the thread owner resolves them." })] }), e("ul", { className: "review-question-list", children: ta.filter((t) => t.blocking && t.state !== "reso\
lved").map((t) => a("li", { children: [e("strong", { children: t.title }), e("span", { children: ls(t.commentType) })] }, t.id)) })] }) : null, s.detail?.blockers?.
  length ? a("section", { className: "blocker-banner", "aria-label": "Task blockers", role: "alert", "aria-live": "assertive", children: [a("div", { children: [
  e("p", { className: "eyebrow", children: "Blockers" }), e("h2", { children: "Work is currently blocked" })] }), e("ul", { className: "blocker-list", children: s.
  detail.blockers.map((t) => a("li", { children: [e("strong", { children: t.label }), e("span", { children: ro(t) })] }, t.id)) })] }) : null, e(LiveTaskFreshnessIndicator, { state: liveFreshness, onManualRefresh: k }), a("section", { className: "\
task-detail-hero", "aria-label": "Task summary", children: [a("div", { className: "task-detail-hero__title", children: [a("div", { className: "task-status-pill",
  "data-status": s.detail?.task?.status || "active", children: [e("span", { "aria-hidden": "true", children: lo(s.detail?.task?.status) }), e("span", { children: rt(
  s.detail?.task?.status) })] }), e("div", { className: "priority-pill", children: s.summary.priority || "No priority" }), oa ? e("div", { className: "routing-b\
adge routing-badge--intake", children: "Intake Draft" }) : null, Qs ? e("div", { className: "routing-badge", children: "Assigned to me" }) : null] }), e(TaskDetailNextActionPanel, { screen: s, principal: h }), a("div", {
  className: "summary-grid summary-grid--hero", children: [a("article", { children: [e("span", { children: "Owner" }), e("strong", { children: s.detail?.summary?.
  owner?.label || s.summary.currentOwner || "Unassigned" })] }), a("article", { children: [e("span", { children: "Workflow stage" }), e("strong", { children: s.
  detail?.summary?.workflowStage?.label || s.summary.currentStage || "\u2014" })] }), a("article", { children: [e("span", { children: "Status" }), e("strong", {
  children: oo(s.detail?.summary?.blockedState, s.detail?.task?.status) }), s.detail?.summary?.blockedState?.waitingOn ? a("small", { children: ["Waiting on ", s.
  detail.summary.blockedState.waitingOn] }) : null] }), a("article", { children: [e("span", { children: "Next action" }), e("strong", { children: s.detail?.summary?.
  nextAction?.label || s.summary.nextRequiredAction || "No next step defined" }), s.detail?.summary?.nextAction?.source ? a("small", { children: ["Source: ", s.
  detail.summary.nextAction.source] }) : null] }), a("article", { children: [e("span", { children: "PR status" }), e("strong", { children: s.detail?.summary?.prStatus?.
  label || "No linked PRs" })] }), a("article", { children: [e("span", { children: "Child tasks" }), e("strong", { children: s.detail?.summary?.childStatus?.label ||
  "No child tasks" })] }), a("article", { children: [e("span", { children: "Deferred considerations" }), a("strong", { children: [xe.summary?.unresolved_count ||
  0, " unresolved"] }), a("small", { children: [xe.summary?.total || 0, " total"] })] }), a("article", { children: [e("span", { children: "Timers and freshness" }),
  e("strong", { children: s.detail?.summary?.timers?.queueAgeLabel || io(s.summary) })] })] })] }), s.detail?.meta?.permissions?.canViewOrchestration === false ?
  a("section", { className: "detail-card detail-card--full", "aria-label": "Orchestration visibility", children: [e("h2", { children: "Orchestration visibility" }),
  e("p", { className: "empty-copy", children: "Dependency planning and orchestration details are hidden for this session." })] }) : s.detail?.orchestration ? a(
  "section", { className: "detail-card detail-card--full", "aria-label": "Orchestration visibility", children: [e("div", { className: "detail-card__header", children: a(
  "div", { children: [e("h2", { children: "Orchestration visibility" }), e("p", { className: "task-list-meta", children: s.detail.orchestration.run.state === "n\
ot_started" ? "Dependency planning is available, but no coordinator run has been started yet." : s.detail.orchestration.run.state === "empty" ? "No child work i\
tems are linked to this task yet." : `Current run state: ${s.detail.orchestration.run.state.replace(/_/g, " ")}.` })] }) }), a("div", { className: "summary-grid\
 orchestration-summary-grid", children: [a("article", { children: [e("span", { children: "Ready" }), e("strong", { children: s.detail.orchestration.run.summary.
  readyCount })] }), a("article", { children: [e("span", { children: "Running" }), e("strong", { children: s.detail.orchestration.run.summary.runningCount })] }),
  a("article", { children: [e("span", { children: "Blocked" }), e("strong", { children: s.detail.orchestration.run.summary.blockedCount })] }), a("article", { children: [
  e("span", { children: "Fallback" }), e("strong", { children: s.detail.orchestration.run.summary.failedCount })] }), a("article", { children: [e("span", { children: "\
Completed" }), e("strong", { children: s.detail.orchestration.run.summary.completedCount })] })] }), s.detail.orchestration.run.items?.length ? a("div", { className: "\
orchestration-table", role: "table", "aria-label": "Orchestrated child work items", children: [e("div", { className: "orchestration-table__head", role: "rowgrou\
p", children: a("div", { role: "row", children: [e("span", { role: "columnheader", children: "Work item" }), e("span", { role: "columnheader", children: "State" }),
  e("span", { role: "columnheader", children: "Dependency status" }), e("span", { role: "columnheader", children: "Why" })] }) }), e("div", { className: "orches\
tration-table__body", role: "rowgroup", children: s.detail.orchestration.run.items.map((t) => a("div", { className: "orchestration-table__row", role: "row", children: [
  a("div", { role: "cell", children: [e("strong", { children: t.title }), a("span", { children: [t.id, t.taskType ? ` \xB7 ${t.taskType}` : ""] })] }), a("div",
  { role: "cell", children: [e("strong", { children: mo(t.state) }), t.specialist ? a("span", { children: [t.specialist, t.actualAgent ? ` \u2192 ${t.actualAgent}` :
  ""] }) : null] }), a("div", { role: "cell", children: [e("strong", { children: po(t.dependencyState) }), t.dependsOn?.length ? a("span", { children: ["Depends\
 on ", t.dependsOn.map((n) => n.id).join(", ")] }) : e("span", { children: "No unmet dependencies" })] }), e("div", { role: "cell", children: t.blockers?.length ?
  e("span", { children: t.blockers.map((n) => n.reason).join(" \xB7 ") }) : t.lastMessage ? e("span", { children: t.lastMessage }) : e("span", { children: "No b\
locker or fallback details." }) })] }, t.id)) })] }) : e("p", { className: "empty-copy", children: "No orchestrated child work items yet." })] }) : null, s.detail?.
  relations?.parentTask || s.detail?.relations?.childTasks?.length || s.detail?.context?.anomalyChildTask || s.detail?.blockers?.some((t) => t.childTaskId) ? a(
  "section", { className: "detail-card detail-card--full", "aria-label": "Anomaly lineage and blocking", children: [e("h2", { children: "Anomaly lineage" }), s.
  detail?.relations?.parentTask ? a("div", { className: "review-question-note", children: [e("span", { children: "Created from parent monitoring anomaly" }), e(
  "p", { children: e("strong", { children: s.detail.relations.parentTask.title }) }), a("p", { className: "task-list-meta", children: [s.detail.relations.parentTask.
  id, " \xB7 ", s.detail.relations.parentTask.stage || "No stage", " \xB7 ", rt(s.detail.relations.parentTask.status), s.detail.relations.parentTask.blocked ? "\
 \xB7 parent currently blocked" : ""] }), s.detail.context?.pmBusinessContextReview?.finalized ? a("p", { className: "task-list-meta", children: ["PM finalized \
business context at ", s.detail.context.pmBusinessContextReview.completedAt || "unknown time", " by ", s.detail.context.pmBusinessContextReview.completedBy || "\
unknown actor", "."] }) : e("p", { className: "task-list-meta", children: "PM review is still required before architect detail work can begin." })] }) : null, s.
  detail?.blockers?.filter((t) => t.childTaskId).map((t) => a("div", { className: "review-question-note", children: [e("span", { children: "Blocked by anomaly c\
hild task" }), e("p", { children: e("strong", { children: t.childTask?.title || t.label }) }), t.childTask ? a("p", { className: "task-list-meta", children: [t.
  childTask.id, " \xB7 ", t.childTask.stage || "No stage", " \xB7 ", rt(t.childTask.status), " \xB7 ", t.childTask.owner?.label || "Unassigned", t.childTask.waitingState ?
  ` \xB7 ${t.childTask.waitingState}` : ""] }) : null, t.reason ? e("p", { children: t.reason }) : null, t.nextRequiredAction ? e("p", { className: "task-list-m\
eta", children: t.nextRequiredAction }) : null, Gn(t.freezeScope).length ? a("p", { className: "task-list-meta", children: [Gn(t.freezeScope).join(" \xB7 "), " \
\xB7 ", t.viewable ? "Viewable" : "Not viewable", " \xB7 ", t.commentable ? "Commentable" : "Comments paused"] }) : null] }, t.id)), s.detail?.relations?.childTasks?.
  length ? a("div", { className: "review-question-note", children: [e("span", { children: "Linked anomaly child tasks" }), e("ul", { className: "detail-bullets",
  children: s.detail.relations.childTasks.map((t) => a("li", { children: [e("strong", { children: t.title }), a("span", { children: [t.id, " \xB7 ", t.stage || "\
No stage", " \xB7 ", rt(t.status), " \xB7 ", t.owner?.label || "Unassigned", t.waitingState ? ` \xB7 ${t.waitingState}` : ""] })] }, t.id)) })] }) : null, s.detail?.
  context?.anomalyChildTask ? a("div", { className: "review-question-note", children: [e("span", { children: "Machine-generated anomaly context" }), e("p", { children: s.
  detail.context.anomalyChildTask.summary || "No anomaly summary captured." }), a("p", { className: "task-list-meta", children: [s.detail.context.anomalyChildTask.
  service || "Unknown service", " \xB7 Source parent: ", s.detail.context.anomalyChildTask.sourceTaskId || "Unavailable", " \xB7 ", s.detail.context.anomalyChildTask.
  finalizedByPm ? "Finalized by PM" : "Machine-generated defaults pending PM review"] }), s.detail.context.anomalyChildTask.finalizedByPm ? a("p", { className: "\
task-list-meta", children: ["Finalized at ", s.detail.context.anomalyChildTask.finalizedAt || "unknown time", " by ", s.detail.context.anomalyChildTask.finalizedBy ||
  "unknown actor", "."] }) : null, e("h3", { children: "Metrics" }), F(s.detail.context.anomalyChildTask.metrics, "No metrics captured."), e("h3", { children: "\
Logs" }), F(s.detail.context.anomalyChildTask.logs, "No logs captured."), e("h3", { children: "Error samples" }), F(s.detail.context.anomalyChildTask.errorSamples,
  "No error samples captured.")] }) : null] }) : null, a("section", { className: "detail-card detail-card--full", "aria-label": "Deferred Considerations", children: [
  a("div", { className: "detail-card__header", children: [a("div", { children: [e("h2", { children: "Deferred Considerations" }), a("p", { className: "task-list\
-meta", children: [xe.summary?.unresolved_count || 0, " unresolved \xB7 ", xe.summary?.total || 0, " total \xB7 Excluded from current approved scope until explicit\
ly promoted."] })] }), e("span", { className: "routing-badge", children: xe.summary?.policy_version || "deferred-considerations.v1" })] }), xe.items?.length ? e(
  "div", { className: "review-question-list", children: xe.items.map((t) => {
    const n = t.id || t.deferred_consideration_id, r = Ra[n] || ka(t), d = ["captured", "reviewed"].includes(t.status), m = K.considerationId === n ? K : { kind: "\
idle", message: "" };
    return a("article", { className: "review-question-note", children: [e("span", { children: Ja(t.status) }), e("p", { children: e("strong", { children: t.title }) }),
    e("p", { children: t.known_context || "No known context recorded." }), a("p", { className: "task-list-meta", children: [n, " \xB7 Owner: ", t.owner || "Unas\
signed", " \xB7 Source: ", t.source_section || "No source section", t.revisit_date ? ` \xB7 Revisit ${t.revisit_date}` : t.revisit_trigger ? ` \xB7 ${t.revisit_trigger}` :
    ""] }), t.rationale ? a("p", { className: "task-list-meta", children: ["Rationale: ", t.rationale] }) : null, t.open_questions?.length ? F(t.open_questions,
    "No open questions recorded.") : null, t.promotion_link?.task_id ? a("p", { className: "task-list-meta", children: ["Promoted intake: ", t.promotion_link.task_id] }) :
    null, d && As ? a("div", { className: "architect-handoff-form", children: [a("label", { children: ["Review note", e("textarea", { value: r.reviewNote, onChange: (v) => St(
    n, { reviewNote: v.target.value }), placeholder: "Why this remains deferred." })] }), a("label", { children: ["Revisit trigger", e("input", { value: r.revisitTrigger,
    onChange: (v) => St(n, { revisitTrigger: v.target.value }), placeholder: "Metric, milestone, or decision point" })] }), a("label", { children: ["Promotion t\
itle", e("input", { value: r.promotionTitle, onChange: (v) => St(n, { promotionTitle: v.target.value }), placeholder: "New Intake Draft title" })] }), a("label",
    { children: ["Promotion note", e("textarea", { value: r.promotionNote, onChange: (v) => St(n, { promotionNote: v.target.value }), placeholder: "Why this sho\
uld become a new Intake Draft." })] }), a("label", { children: ["Close no-action rationale", e("textarea", { value: r.closeRationale, onChange: (v) => St(n, { closeRationale: v.
    target.value }), placeholder: "Why no follow-up action is needed." })] }), a("div", { className: "assignment-form__actions", children: [e("button", { type: "\
button", className: "button-secondary", onClick: () => {
      $a(t, "leave_deferred");
    }, disabled: m.kind === "loading", children: "Leave deferred" }), e("button", { type: "button", onClick: () => {
      $a(t, "promote");
    }, disabled: m.kind === "loading", children: "Promote to Intake Draft" }), e("button", { type: "button", className: "button-secondary", onClick: () => {
      $a(t, "close");
    }, disabled: m.kind === "loading", children: "Close no action" })] }), m.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${m.kind}`,
    role: m.kind === "error" ? "alert" : "status", children: m.message }) : null] }) : null] }, n);
  }) }) : e("p", { className: "empty-copy", children: "No Deferred Considerations are recorded for this task." }), Ts ? a("form", { className: "architect-handof\
f-form", onSubmit: Fs, children: [e("h3", { children: "Capture Deferred Consideration" }), a("label", { children: ["Title", e("input", { value: T.title, onChange: (t) => z(
  (n) => ({ ...n, title: t.target.value })) })] }), a("label", { children: ["Known context", e("textarea", { value: T.knownContext, onChange: (t) => z((n) => ({
  ...n, knownContext: t.target.value })) })] }), a("label", { children: ["Rationale for deferring", e("textarea", { value: T.rationale, onChange: (t) => z((n) => ({
  ...n, rationale: t.target.value })) })] }), a("label", { children: ["Source section", e("input", { value: T.sourceSection, onChange: (t) => z((n) => ({ ...n, sourceSection: t.
  target.value })) })] }), a("label", { children: ["Source comment", e("textarea", { value: T.sourceComment, onChange: (t) => z((n) => ({ ...n, sourceComment: t.
  target.value })) })] }), a("label", { children: ["Source agent", e("input", { value: T.sourceAgent, onChange: (t) => z((n) => ({ ...n, sourceAgent: t.target.value })) })] }),
  a("label", { children: ["Responsible role", e("input", { value: T.owner, onChange: (t) => z((n) => ({ ...n, owner: t.target.value })) })] }), a("label", { children: [
  "Revisit trigger", e("input", { value: T.revisitTrigger, onChange: (t) => z((n) => ({ ...n, revisitTrigger: t.target.value })) })] }), a("label", { children: [
  "Revisit date", e("input", { type: "date", value: T.revisitDate, onChange: (t) => z((n) => ({ ...n, revisitDate: t.target.value })) })] }), a("label", { children: [
  "Open questions", e("textarea", { value: T.openQuestions, onChange: (t) => z((n) => ({ ...n, openQuestions: t.target.value })) })] }), e("div", { className: "\
assignment-form__actions", children: e("button", { type: "submit", disabled: K.kind === "loading" && K.action === "capture", children: K.kind === "loading" && K.
  action === "capture" ? "Capturing\u2026" : "Capture Deferred Consideration" }) }), K.kind !== "idle" && K.action === "capture" ? e("p", { className: `assignme\
nt-status assignment-status--${K.kind}`, role: K.kind === "error" ? "alert" : "status", children: K.message }) : null] }) : null] }), s.detail?.context?.closeGovernance?.
  active ? a("section", { id: "task-detail-close-review-section", className: "detail-card detail-card--full", "aria-label": "Close review governance", children: [e("h2", { children: "Close review gove\
rnance" }), a("div", { className: "review-question-note", children: [e("span", { children: uo(s.detail.context.closeGovernance.readiness?.state) }), e("p", { children: s.
  detail.context.closeGovernance.humanDecision?.summary || s.detail.context.closeGovernance.escalation?.summary || s.detail.summary?.nextAction?.label || "Gover\
ned close review is active." }), a("p", { className: "task-list-meta", children: [Va(s.detail.context.closeGovernance.humanDecision?.status), s.detail.context.closeGovernance.
  backtrack?.available ? " \xB7 Backtrack to implementation is available if the close gate fails." : ""] })] }), a("div", { className: "review-question-note", children: [
  e("span", { children: "Readiness checklist" }), e("ul", { className: "detail-bullets", children: (s.detail.context.closeGovernance.readiness?.checklist || []).
  map((t) => a("li", { children: [e("strong", { children: t.label }), a("span", { children: [co(t.status), " \xB7 ", t.detail] })] }, t.key || t.id || t.label)) })] }),
  s.detail.context.closeGovernance.deferredConsiderations?.unresolved?.length ? a("div", { className: "review-question-note", children: [e("span", { children: "\
Deferred Considerations are not close blockers" }), a("p", { className: "task-list-meta", children: [s.detail.context.closeGovernance.deferredConsiderations.unresolved_count,
  " unresolved \xB7 Actions available: leave deferred, promote to Intake Draft, close no action."] }), e("ul", { className: "detail-bullets", children: s.detail.
  context.closeGovernance.deferredConsiderations.unresolved.map((t) => a("li", { children: [e("strong", { children: t.title }), a("span", { children: [t.id, " \xB7\
 ", Ja(t.status), " \xB7 ", t.owner || "Unassigned"] })] }, t.id)) })] }) : null, s.detail.context.closeGovernance.cancellation?.recommendations?.pm || s.detail.
  context.closeGovernance.cancellation?.recommendations?.architect ? a("div", { className: "review-question-note", children: [e("span", { children: "Cancellatio\
n recommendations" }), s.detail.context.closeGovernance.cancellation.recommendations.pm ? a("div", { className: "review-question-note__recommendation", children: [
  a("p", { children: [e("strong", { children: "PM:" }), " ", s.detail.context.closeGovernance.cancellation.recommendations.pm.summary || "Recommendation recorde\
d."] }), s.detail.context.closeGovernance.cancellation.recommendations.pm.rationale ? e("p", { className: "task-list-meta", children: s.detail.context.closeGovernance.
  cancellation.recommendations.pm.rationale }) : null] }) : null, s.detail.context.closeGovernance.cancellation.recommendations.architect ? a("div", { className: "\
review-question-note__recommendation", children: [a("p", { children: [e("strong", { children: "Architect:" }), " ", s.detail.context.closeGovernance.cancellation.
  recommendations.architect.summary || "Recommendation recorded."] }), s.detail.context.closeGovernance.cancellation.recommendations.architect.rationale ? e("p",
  { className: "task-list-meta", children: s.detail.context.closeGovernance.cancellation.recommendations.architect.rationale }) : null] }) : null, s.detail.context.
  closeGovernance.cancellation.awaitingHumanDecision ? e("p", { className: "task-list-meta", children: "Human stakeholder decision is still required before the \
cancellation path can conclude." }) : null] }) : null, s.detail.context.closeGovernance.escalation ? a("div", { className: "review-question-note", children: [e(
  "span", { children: s.detail.context.closeGovernance.escalation.source === "monitoring_expiry" ? "Monitoring expiry escalation" : "Exceptional dispute escalat\
ion" }), e("p", { children: s.detail.context.closeGovernance.escalation.summary }), a("p", { children: [e("strong", { children: "Recommendation:" }), " ", s.detail.
  context.closeGovernance.escalation.recommendation || "Human review required."] }), s.detail.context.closeGovernance.escalation.rationale ? e("p", { className: "\
task-list-meta", children: s.detail.context.closeGovernance.escalation.rationale }) : null] }) : null, s.detail.context.closeGovernance.humanDecision?.latestDecision ?
  a("div", { className: "review-question-note", children: [e("span", { children: "Latest human decision" }), e("p", { children: e("strong", { children: Va(s.detail.
  context.closeGovernance.humanDecision.status) }) }), s.detail.context.closeGovernance.humanDecision.latestDecision.summary ? e("p", { children: s.detail.context.
  closeGovernance.humanDecision.latestDecision.summary }) : null, s.detail.context.closeGovernance.humanDecision.latestDecision.rationale ? e("p", { className: "\
task-list-meta", children: s.detail.context.closeGovernance.humanDecision.latestDecision.rationale }) : null] }) : null, s.detail.context.closeGovernance.backtrack?.
  latestReason ? a("div", { className: "review-question-note", children: [e("span", { children: "Backtrack signal" }), e("p", { children: s.detail.context.closeGovernance.
  backtrack.latestReason })] }) : null, Us ? a("form", { className: "architect-handoff-form", onSubmit: ni, children: [a("label", { children: ["Cancellation rec\
ommendation summary", e("textarea", { value: vt.summary, onChange: (t) => _a((n) => ({ ...n, summary: t.target.value })), placeholder: "Short recommendation sum\
mary for PM or Architect review." })] }), a("label", { children: ["Cancellation rationale", e("textarea", { value: vt.rationale, onChange: (t) => _a((n) => ({ ...n,
  rationale: t.target.value })), placeholder: "Why cancellation is the governed outcome." })] }), e("div", { className: "assignment-form__actions", children: e(
  "button", { type: "submit", disabled: Ye.kind === "loading", children: Ye.kind === "loading" ? "Recording\u2026" : "Record cancellation recommendation" }) }),
  Ye.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${Ye.kind}`, role: Ye.kind === "error" ? "alert" : "status", children: Ye.message }) :
  null] }) : null, $s ? a("form", { className: "architect-handoff-form", onSubmit: si, children: [a("label", { children: ["Exceptional dispute summary", e("text\
area", { value: ce.summary, onChange: (t) => kt((n) => ({ ...n, summary: t.target.value })), placeholder: "Short summary of the disputed close-review outcome." })] }),
  a("label", { children: ["Recommendation for human decision", e("textarea", { value: ce.recommendation, onChange: (t) => kt((n) => ({ ...n, recommendation: t.target.
  value })), placeholder: "Recommendation shown on the human decision card." })] }), a("label", { children: ["Dispute rationale", e("textarea", { value: ce.rationale,
  onChange: (t) => kt((n) => ({ ...n, rationale: t.target.value })), placeholder: "Explain why the close path is disputed and needs explicit human resolution." })] }),
  a("label", { children: ["Escalation severity", a("select", { "aria-label": "Escalation severity", value: ce.severity, onChange: (t) => kt((n) => ({ ...n, severity: t.
  target.value })), children: [e("option", { value: "warning", children: "Warning" }), e("option", { value: "high", children: "High" }), e("option", { value: "c\
ritical", children: "Critical" })] })] }), e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: Xe.kind === "load\
ing", children: Xe.kind === "loading" ? "Escalating\u2026" : "Escalate exceptional dispute" }) }), Xe.kind !== "idle" ? e("p", { className: `assignment-status a\
ssignment-status--${Xe.kind}`, role: Xe.kind === "error" ? "alert" : "status", children: Xe.message }) : null] }) : null, Bs ? a("form", { className: "architect\
-handoff-form", onSubmit: ii, children: [a("label", { children: ["Human decision", a("select", { "aria-label": "Human decision", value: ve.outcome, onChange: (t) => jt(
  (n) => ({ ...n, outcome: t.target.value })), children: [e("option", { value: "approve", children: "Approve" }), e("option", { value: "reject", children: "Reje\
ct" }), e("option", { value: "request_more_context", children: "Request more context" })] })] }), a("label", { children: ["Decision summary", e("textarea", { value: ve.
  summary, onChange: (t) => jt((n) => ({ ...n, summary: t.target.value })), placeholder: "Short, mobile-scannable decision summary." })] }), a("label", { children: [
  "Rationale", e("textarea", { value: ve.rationale, onChange: (t) => jt((n) => ({ ...n, rationale: t.target.value })), placeholder: "Required when rejecting or \
requesting more context." })] }), e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: Ze.kind === "loading", children: Ze.
  kind === "loading" ? "Recording\u2026" : "Record human decision" }) }), Ze.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${Ze.kind}`,
  role: Ze.kind === "error" ? "alert" : "status", children: Ze.message }) : null] }) : null, Os ? a("form", { className: "architect-handoff-form", onSubmit: ri,
  children: [a("label", { children: ["Backtrack reason", a("select", { "aria-label": "Backtrack reason", value: de.reasonCode, onChange: (t) => bt((n) => ({ ...n,
  reasonCode: t.target.value })), children: [e("option", { value: "criteria_gap", children: "Criteria gap" }), e("option", { value: "open_child_tasks", children: "\
Open child tasks" }), e("option", { value: "open_pull_requests", children: "Open pull requests" }), e("option", { value: "monitoring_degraded", children: "Monit\
oring degraded" }), e("option", { value: "cancellation_rejected", children: "Cancellation rejected" }), e("option", { value: "other", children: "Other" })] })] }),
  a("label", { children: ["Agreement artifact", e("input", { value: de.agreementArtifact, onChange: (t) => bt((n) => ({ ...n, agreementArtifact: t.target.value })),
  placeholder: "pm+architect-close-review-2026-04-15" })] }), a("label", { children: ["Backtrack rationale", e("textarea", { value: de.rationale, onChange: (t) => bt(
  (n) => ({ ...n, rationale: t.target.value })), placeholder: "Why the close gate failed and implementation must resume." })] }), a("label", { children: ["Backt\
rack summary", e("textarea", { value: de.summary, onChange: (t) => bt((n) => ({ ...n, summary: t.target.value })), placeholder: "Optional short summary for the \
audit trail." })] }), e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: et.kind === "loading", children: et.kind ===
  "loading" ? "Backtracking\u2026" : "Backtrack to implementation" }) }), et.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${et.kind}`,
  role: et.kind === "error" ? "alert" : "status", children: et.message }) : null] }) : null] }) : null, L && !oa && it(L.current_stage) ? a("section", { id: "task-detail-lifecycle-controls", className: "\
detail-card detail-card--full", "aria-label": "Lifecycle controls", children: [e("h2", { children: "Lifecycle controls" }), e("p", { children: "Valid transition\
s follow the US-004 lifecycle state machine. Invalid moves are blocked before the stage event is sent." }), L.current_stage === "VERIFY" ? a(q, { children: [a("\
label", { children: ["SRE finding note", e("textarea", { value: vn, onChange: (t) => Ta(t.target.value), placeholder: "Required when reopening from VERIFY." })] }),
  a("div", { className: "assignment-form__actions", children: [e("button", { type: "button", onClick: () => {
    _t({ item: L, toStage: "DONE", source: "detail-sre-approve" });
  }, disabled: J.kind === "loading", children: "Approve" }), e("button", { type: "button", className: "button-secondary", onClick: () => {
    _t({ item: L, toStage: "REOPEN", note: vn, source: "detail-sre-reopen" });
  }, disabled: J.kind === "loading", children: "Find Issues" })] })] }) : e("div", { className: "assignment-form__actions", children: L.current_stage === "BACKL\
OG" || L.current_stage === "TODO" || L.current_stage === "IN_PROGRESS" || L.current_stage === "REOPEN" ? ["BACKLOG", "TODO", "IN_PROGRESS", "VERIFY"].filter((t) => t !==
  L.current_stage).map((t) => a("button", { type: "button", className: "button-secondary", onClick: () => {
    _t({ item: L, toStage: t, source: "detail-lifecycle" });
  }, disabled: J.kind === "loading" || !Bn(L, t, h, j).allowed, children: ["Move to ", t] }, t)) : null }), J.kind !== "idle" ? e("p", { className: `assignment-\
status assignment-status--${J.kind}`, role: J.kind === "error" ? "alert" : "status", children: J.message }) : null] }) : null, fe ? a("section", { className: "d\
etail-card detail-card--full", "aria-label": "Task lock status", children: [e("h2", { children: "Task lock" }), a("p", { children: ["This task is locked by ", e(
  "strong", { children: fe.ownerId }), fe.reason ? ` for ${fe.reason}` : "", "."] }), a("p", { className: "task-list-meta", children: ["Expires at ", fe.expiresAt ||
  "unknown", fe.action ? ` \xB7 Action: ${fe.action}` : "", ". Refresh or retry after the lock expires if you are not the lock holder."] }), _n ? e("div", { className: "\
assignment-form__actions", children: fe.ownerId === h?.sub ? a(q, { children: [e("button", { type: "button", onClick: Ba, disabled: $.kind === "loading", children: $.
  kind === "loading" ? "Renewing\u2026" : "Renew lock" }), e("button", { type: "button", className: "button-secondary", onClick: Ys, disabled: $.kind === "loadi\
ng", children: "Release lock" }), e("button", { type: "button", className: "button-secondary", onClick: () => {
    k();
  }, disabled: $.kind === "loading", children: "Refresh task state" })] }) : a(q, { children: [e("button", { type: "button", onClick: Ba, disabled: $.kind === "\
loading", children: $.kind === "loading" ? "Refreshing\u2026" : "Retry acquire after refresh" }), e("button", { type: "button", className: "button-secondary", onClick: () => {
    k();
  }, disabled: $.kind === "loading", children: "Refresh task state" })] }) }) : null, $.kind !== "idle" ? e("p", { className: `assignment-status assignment-stat\
us--${$.kind}`, role: $.kind === "error" ? "alert" : "status", children: $.message }) : null] }) : _n ? a("section", { className: "detail-card detail-card--full",
  "aria-label": "Task lock controls", children: [e("h2", { children: "Task lock" }), e("p", { children: "No active lock. Acquire one before making a larger work\
flow change if you need to keep the task stable while editing." }), a("div", { className: "assignment-form__actions", children: [e("button", { type: "button", onClick: Ba,
  disabled: $.kind === "loading", children: $.kind === "loading" ? "Acquiring\u2026" : "Acquire lock" }), e("button", { type: "button", className: "button-secon\
dary", onClick: () => {
    k();
  }, disabled: $.kind === "loading", children: "Refresh task state" })] }), $.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${$.kind}`,
  role: $.kind === "error" ? "alert" : "status", children: $.message }) : null] }) : null, a("section", { className: "detail-sections", "aria-label": "Task deta\
il sections", children: [a("section", { id: "task-detail-overview-section", className: "detail-card", children: [e("h2", { children: "Overview" }), s.detail?.context?.operatorIntakeRequirements ? a(
  q, { children: [e("h3", { children: "Operator intake requirements" }), e("p", { children: s.detail.context.operatorIntakeRequirements })] }) : null, e("p", { children: s.
  detail?.context?.businessContext || s.summary.businessContext || "Business context is missing." }), Rn ? a("form", { className: "architect-handoff-form", onSubmit: ai,
  children: [a("div", { className: "review-question-note", children: [e("span", { children: "PM business-context re-entry" }), e("p", { children: "Finalize the \
machine-generated business context before architect detail work can begin." })] }), a("label", { children: ["Finalized business context", e("textarea", { value: Sa.
  businessContext, onChange: (t) => pn({ businessContext: t.target.value }), placeholder: "Refine the business impact, customer risk, and delivery expectations \
for this anomaly child task." })] }), e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: Je.kind === "loading" ||
  !Es, children: Je.kind === "loading" ? "Finalizing\u2026" : "Complete PM context review" }) }), Je.kind !== "idle" ? e("p", { className: `assignment-status as\
signment-status--${Je.kind}`, role: Je.kind === "error" ? "alert" : "status", children: Je.message }) : null] }) : null, e("h3", { children: "Acceptance criteri\
a" }), F(s.detail?.context?.acceptanceCriteria || s.summary.acceptanceCriteria, "Acceptance criteria are missing."), e("h3", { children: "Definition of Done" }),
  F(s.detail?.context?.definitionOfDone || s.summary.definitionOfDone, "Definition of Done is missing.")] }), a("section", { id: "task-detail-delivery-section", className: "detail-card", children: [
  e("h2", { children: "Delivery" }), s.detail?.context?.architectHandoff ? a("div", { className: "architect-handoff-summary", children: [a("div", { className: "\
summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "Engineer tier" }), e("strong", { children: s.detail.context.
  architectHandoff.engineerTier })] }), a("article", { children: [e("span", { children: "Handoff version" }), a("strong", { children: ["v", s.detail.context.architectHandoff.
  version] })] }), a("article", { children: [e("span", { children: "Readiness" }), e("strong", { children: s.detail.context.architectHandoff.readyForEngineering ?
  "Ready for engineering" : "Draft" })] }), a("article", { children: [e("span", { children: "Submitted by" }), e("strong", { children: s.detail.context.architectHandoff.
  submittedBy || "Unknown" })] })] }), e("p", { className: "task-list-meta", children: zn(s.detail.context.architectHandoff.engineerTier) }), e("h3", { children: "\
Tier rationale" }), e("p", { children: s.detail.context.architectHandoff.tierRationale || "Tier rationale is missing." })] }) : null, e("h3", { children: "Techn\
ical spec" }), e("p", { children: s.detail?.context?.technicalSpec || "Technical spec is missing." }), e("h3", { children: "Monitoring spec" }), e("p", { children: s.
  detail?.context?.monitoringSpec || "Monitoring spec is missing." }), e("h3", { children: "Responsible escalation" }), wn ? a("form", { className: "architect-h\
andoff-form", onSubmit: async (t) => {
    t.preventDefault();
    const n = rn.reason.trim();
    if (!qa) {
      Le({ kind: "error", message: "Responsible escalation is only available for Jr-tier work before implementation starts." });
      return;
    }
    if (!n) {
      Le({ kind: "error", message: "Explain why this task needs higher-tier support." });
      return;
    }
    try {
      Le({ kind: "loading", message: "Requesting higher-tier support\u2026" }), await p.requestSkillEscalation(g, { reason: n }), await k(), Le({ kind: "success",
      message: "Responsible escalation recorded and surfaced for architect review." });
    } catch (r) {
      Le({ kind: "error", message: r.message || "Responsible escalation failed." });
    }
  }, children: [a("label", { children: ["Why does this need higher-tier support?", e("textarea", { value: rn.reason, onChange: (t) => ln({ reason: t.target.value }),
  placeholder: "Describe the scope, risk, or architectural complexity driving the escalation." })] }), qa ? null : e("p", { className: "assignment-status", role: "\
status", children: "Responsible escalation is available only for Jr-tier work before implementation starts." }), e("div", { className: "assignment-form__actions",
  children: e("button", { type: "submit", disabled: Oe.kind === "loading" || !qa, children: Oe.kind === "loading" ? "Submitting\u2026" : "Request higher-tier su\
pport" }) }), Oe.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${Oe.kind}`, role: Oe.kind === "error" ? "alert" : "status", children: Oe.
  message }) : null] }) : e("p", { className: "assignment-status", role: "status", children: "Responsible escalation controls are available to engineer/admin be\
arer tokens." }), e("h3", { children: "Engineering handoff" }), xs ? a("form", { className: "architect-handoff-form", onSubmit: async (t) => {
    t.preventDefault(); const r = new FormData(t.currentTarget), n = (i, d) => String(r.get(i) ?? d);
    try {
      Bt({ kind: "loading", message: "Submitting engineering handoff\u2026" }), await p.submitArchitectHandoff(g, { readyForEngineering: r.has("readyForEngineering"), engineerTier: n("engineerTier", U.
      engineerTier), tierRationale: n("tierRationale", U.tierRationale), technicalSpec: { summary: n("technicalSpecSummary", U.technicalSpec.summary), scope: n("technicalSpecScope", U.technicalSpec.scope), design: n("technicalSpecDesign", U.technicalSpec.design), rolloutPlan: n("technicalSpecRolloutPlan", U.technicalSpec.rolloutPlan) }, monitoringSpec: { service: n("monitoringService", U.monitoringSpec.service), dashboardUrls: n("monitoringDashboardUrls", U.monitoringSpec.dashboardUrls), alertPolicies: n("monitoringAlertPolicies", U.monitoringSpec.alertPolicies), runbook: n("monitoringRunbook", U.monitoringSpec.runbook), successMetrics: n("monitoringSuccessMetrics", U.monitoringSpec.successMetrics) } }), await k(), Bt({ kind: "success", message: "\
Engineering handoff submitted." });
    } catch (n) {
      Bt({ kind: "error", message: n.message || "Engineering handoff failed." });
    }
  }, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { children: ["Technical summary", e("textarea", { value: U.technicalSpec.
  summary, name: "technicalSpecSummary", onChange: (t) => G((n) => ({ ...n, technicalSpec: { ...n.technicalSpec, summary: t.target.value } })), placeholder: "Summarize the implementation con\
tract and boundaries." })] }), a("label", { children: ["Scope and constraints", e("textarea", { value: U.technicalSpec.scope, onChange: (t) => G((n) => ({ ...n,
  technicalSpec: { ...n.technicalSpec, scope: t.target.value } })), name: "technicalSpecScope", placeholder: "Call out scope, constraints, and assumptions." })] }), a("label", { children: [
  "Design and interfaces", e("textarea", { value: U.technicalSpec.design, onChange: (t) => G((n) => ({ ...n, technicalSpec: { ...n.technicalSpec, design: t.target.
  value } })), name: "technicalSpecDesign", placeholder: "Describe components, APIs, data contracts, and dependencies." })] }), a("label", { children: ["Rollout plan", e("textarea", { value: U.
  technicalSpec.rolloutPlan, onChange: (t) => G((n) => ({ ...n, technicalSpec: { ...n.technicalSpec, rolloutPlan: t.target.value } })), placeholder: "Explain ro\
llout sequencing, migrations, and fallback.", name: "technicalSpecRolloutPlan" })] }), a("label", { children: ["Monitored service", e("input", { value: U.monitoringSpec.service, name: "monitoringService", onChange: (t) => G(
  (n) => ({ ...n, monitoringSpec: { ...n.monitoringSpec, service: t.target.value } })), placeholder: "workflow-audit-api" })] }), a("label", { children: ["Dashb\
oard URLs", e("textarea", { value: U.monitoringSpec.dashboardUrls, onChange: (t) => G((n) => ({ ...n, monitoringSpec: { ...n.monitoringSpec, dashboardUrls: t.target.
  value } })), name: "monitoringDashboardUrls", placeholder: "One URL per line" })] }), a("label", { children: ["Alert policies", e("textarea", { value: U.monitoringSpec.alertPolicies, onChange: (t) => G(
  (n) => ({ ...n, monitoringSpec: { ...n.monitoringSpec, alertPolicies: t.target.value } })), name: "monitoringAlertPolicies", placeholder: "One alert policy per line" })] }), a("label", { children: [
  "Runbook", e("input", { value: U.monitoringSpec.runbook, onChange: (t) => G((n) => ({ ...n, monitoringSpec: { ...n.monitoringSpec, runbook: t.target.value } })),
  placeholder: "docs/runbooks/example.md", name: "monitoringRunbook" })] }), a("label", { children: ["Success metrics", e("textarea", { value: U.monitoringSpec.successMetrics, onChange: (t) => G(
  (n) => ({ ...n, monitoringSpec: { ...n.monitoringSpec, successMetrics: t.target.value } })), name: "monitoringSuccessMetrics", placeholder: "One metric per line" })] }), a("label", { children: [
  "Engineer tier", a("select", { value: U.engineerTier, name: "engineerTier", onChange: (t) => G((n) => ({ ...n, engineerTier: t.target.value })), children: [e("option", { value: "Pr\
incipal", children: "Principal" }), e("option", { value: "Sr", children: "Sr" }), e("option", { value: "Jr", children: "Jr" })] }), e("small", { children: zn(U.
  engineerTier) })] }), a("label", { className: "architect-handoff-grid__full", children: ["Tier rationale", e("textarea", { value: U.tierRationale, onChange: (t) => G(
  (n) => ({ ...n, tierRationale: t.target.value })), name: "tierRationale", placeholder: "Explain why this level of engineering ownership is required." })] })] }), a("label", { className: "\
review-question-checkbox", children: [e("input", { type: "checkbox", checked: U.readyForEngineering, onChange: (t) => G((n) => ({ ...n, readyForEngineering: t.target.
  checked })), name: "readyForEngineering" }), "Ready for engineering. This formal handoff is required before implementation begins."] }), e("div", { className: "assignment-form__actions", children: e(
  "button", { type: "submit", disabled: $e.kind === "loading", children: $e.kind === "loading" ? "Submitting\u2026" : "Submit engineering handoff" }) }), $e.kind !==
  "idle" ? e("p", { className: `assignment-status assignment-status--${$e.kind}`, role: $e.kind === "error" ? "alert" : "status", children: $e.message }) : null] }) :
  e("p", { className: "assignment-status", role: "status", children: "Engineering handoff controls are available to architect/admin bearer tokens." }), e("h3", {
  children: "Implementation handoff" }), s.detail?.context?.engineerSubmission ? a("div", { className: "architect-handoff-summary", children: [a("div", { className: "\
summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "Primary reference" }), e("strong", { children: s.detail.
  context.engineerSubmission.primaryReference?.label || "Pending submission" })] }), a("article", { children: [e("span", { children: "Submission version" }), a(
  "strong", { children: ["v", s.detail.context.engineerSubmission.version] })] }), a("article", { children: [e("span", { children: "Submitted by" }), e("strong",
  { children: s.detail.context.engineerSubmission.submittedBy || "Unknown" })] }), a("article", { children: [e("span", { children: "QA readiness" }), e("strong",
  { children: s.detail.context.engineerSubmission.primaryReference ? "Ready for QA handoff" : "Metadata missing" })] })] }), s.detail.context.engineerSubmission.
  commitSha ? a(q, { children: [e("h3", { children: "Commit SHA" }), e("p", { className: "implementation-reference implementation-reference--mono", children: s.
  detail.context.engineerSubmission.commitSha })] }) : null, s.detail.context.engineerSubmission.prUrl ? a(q, { children: [e("h3", { children: "Pull request" }),
  e("p", { className: "implementation-reference implementation-reference--mono", children: s.detail.context.engineerSubmission.prUrl })] }) : null] }) : null, s.
  detail?.context?.implementationHistory?.length > 1 ? a(q, { children: [e("h3", { children: "Previous fix history" }), e("ul", { className: "detail-feed", children: s.
  detail.context.implementationHistory.map((t) => a("li", { children: [a("strong", { children: ["v", t.version, " \xB7 ", t.primaryReference?.label || t.commitSha ||
  t.prUrl || "Implementation reference missing"] }), a("span", { children: [t.submittedBy || "Unknown engineer", " \xB7 ", t.submittedAt || "No timestamp"] })] },
  `${t.version}-${t.eventId || t.submittedAt}`)) })] }) : null, e("h3", { children: "Engineer activity monitoring" }), pe ? a("div", { className: "architect-han\
doff-summary", children: [a("div", { className: "summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "Require\
d check-in interval" }), a("strong", { children: [pe.requiredCheckInIntervalMinutes || 15, " min"] })] }), a("article", { children: [e("span", { children: "Miss\
ed check-ins" }), e("strong", { children: pe.missedCheckIns ?? 0 })] }), a("article", { children: [e("span", { children: "Threshold" }), e("strong", { children: pe.
  threshold || 2 })] }), a("article", { children: [e("span", { children: "Inactivity review" }), e("strong", { children: pe.thresholdReached ? "Threshold reache\
d" : "Within window" })] })] }), pe.lastActivity ? a("p", { className: "task-list-meta", children: ["Latest qualifying engineer activity: ", pe.lastActivity.summary ||
  pe.lastActivity.type, " \xB7 ", pe.lastActivity.occurredAt || "No timestamp"] }) : e("p", { className: "task-list-meta", children: "No qualifying engineer act\
ivity signal has been recorded yet." })] }) : null, yn ? a("form", { className: "architect-handoff-form", onSubmit: async (t) => {
    t.preventDefault();
    const n = Mt.summary.trim();
    if (!Re) {
      Ge({ kind: "error", message: "Check-ins can only be recorded while the task is in implementation." });
      return;
    }
    if (!n) {
      Ge({ kind: "error", message: "A concrete progress summary is required." });
      return;
    }
    try {
      Ge({ kind: "loading", message: "Recording check-in\u2026" }), await p.recordEngineerCheckIn(g, { summary: n, evidence: B(Mt.evidence) }), await k(), Ge({ kind: "\
success", message: "Check-in recorded." });
    } catch (r) {
      Ge({ kind: "error", message: r.message || "Check-in failed." });
    }
  }, children: [a("label", { children: ["Progress summary", e("textarea", { value: Mt.summary, onChange: (t) => wa((n) => ({ ...n, summary: t.target.value })), placeholder: "\
Describe concrete progress since the last qualifying engineer signal." })] }), a("label", { children: ["Evidence", e("textarea", { value: Mt.evidence, onChange: (t) => wa(
  (n) => ({ ...n, evidence: t.target.value })), placeholder: "Optional references, one per line." })] }), Re ? null : e("p", { className: "assignment-status", role: "\
status", children: "Check-ins can only be recorded while the task is in implementation." }), e("div", { className: "assignment-form__actions", children: e("butt\
on", { type: "submit", disabled: He.kind === "loading" || !Re, children: He.kind === "loading" ? "Submitting\u2026" : "Record engineer check-in" }) }), He.kind !==
  "idle" ? e("p", { className: `assignment-status assignment-status--${He.kind}`, role: He.kind === "error" ? "alert" : "status", children: He.message }) : null] }) :
  null, s.detail?.context?.transferredContext ? a(q, { children: [e("h3", { children: "Transferred context" }), a("div", { className: "architect-handoff-summary",
  children: [a("div", { className: "summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "Previous owner" }), e(
  "strong", { children: s.detail.context.transferredContext.prior_assignee || "Unknown" })] }), a("article", { children: [e("span", { children: "New owner" }), e(
  "strong", { children: s.detail.context.transferredContext.new_assignee || "Unassigned" })] }), a("article", { children: [e("span", { children: "Tier change" }),
  a("strong", { children: [s.detail.context.transferredContext.previous_engineer_tier || "\u2014", " -> ", s.detail.context.transferredContext.new_engineer_tier ||
  "\u2014"] })] }), a("article", { children: [e("span", { children: "Transfer mode" }), e("strong", { children: s.detail.context.transferredContext.mode || "man\
ual" })] })] }), e("p", { children: s.detail.context.transferredContext.reason || "No transfer rationale recorded." }), s.detail.context.transferredContext.latest_activity ?
  a("p", { className: "task-list-meta", children: ["Latest qualifying engineer activity: ", s.detail.context.transferredContext.latest_activity.summary || s.detail.
  context.transferredContext.latest_activity.type, " \xB7 ", s.detail.context.transferredContext.latest_activity.occurredAt || "No timestamp"] }) : null, s.detail.
  context.transferredContext.latest_implementation_reference ? e("p", { className: "implementation-reference implementation-reference--mono", children: typeof s.
  detail.context.transferredContext.latest_implementation_reference == "string" ? s.detail.context.transferredContext.latest_implementation_reference : s.detail.
  context.transferredContext.latest_implementation_reference.label || "Implementation reference attached" }) : null, s.detail.context.transferredContext.unresolved_threads?.
  length ? a(q, { children: [e("h3", { children: "Open workflow context" }), e("ul", { className: "detail-bullets", children: s.detail.context.transferredContext.
  unresolved_threads.map((t) => e("li", { children: t }, t)) })] }) : null, s.detail.context.transferredContext.blockers?.length ? a(q, { children: [e("h3", { children: "\
Current blockers" }), e("ul", { className: "detail-bullets", children: s.detail.context.transferredContext.blockers.map((t) => e("li", { children: t }, t)) })] }) :
  null] })] }) : null, s.detail?.context?.ghostingReview?.reviewTaskId ? a(q, { children: [e("h3", { children: "Linked inactivity review" }), a("div", { className: "\
architect-handoff-summary", children: [e("p", { children: e("a", { href: `/tasks/${encodeURIComponent(s.detail.context.ghostingReview.reviewTaskId)}`, onClick: (t) => {
    t.preventDefault(), l(`/tasks/${encodeURIComponent(s.detail.context.ghostingReview.reviewTaskId)}`);
  }, children: s.detail.context.ghostingReview.title || s.detail.context.ghostingReview.reviewTaskId }) }), a("p", { className: "task-list-meta", children: ["Go\
vernance review task created at ", s.detail.context.ghostingReview.createdAt || "unknown time", " to track the inactivity-based reassignment outcome."] })] })] }) :
  null, e("h3", { children: "Architect tiering and reassignment" }), Rs ? a(q, { children: [a("form", { className: "architect-handoff-form", onSubmit: async (t) => {
    t.preventDefault();
    const n = ct.engineerTier.trim(), r = ct.tierRationale.trim();
    if (!n || !r) {
      dt({ kind: "error", message: "Engineer tier and tier rationale are required." });
      return;
    }
    try {
      dt({ kind: "loading", message: "Updating engineer tier\u2026" }), await p.retierTask(g, { engineerTier: n, tierRationale: r, reason: ct.reason.trim() }), await k(),
      dt({ kind: "success", message: "Engineer tier updated." });
    } catch (d) {
      dt({ kind: "error", message: d.message || "Re-tier failed." });
    }
  }, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { children: ["Target engineer tier", a("select", { value: ct.
  engineerTier, onChange: (t) => Na((n) => ({ ...n, engineerTier: t.target.value })), children: [e("option", { value: "Principal", children: "Principal" }), e("\
option", { value: "Sr", children: "Sr" }), e("option", { value: "Jr", children: "Jr" })] })] }), a("label", { className: "architect-handoff-grid__full", children: [
  "Re-tier rationale", e("textarea", { value: ct.tierRationale, onChange: (t) => Na((n) => ({ ...n, tierRationale: t.target.value })), placeholder: "Explain why\
 this level of engineering ownership is required now." })] })] }), e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: Qe.
  kind === "loading", children: Qe.kind === "loading" ? "Submitting\u2026" : "Update engineer tier" }) }), Qe.kind !== "idle" ? e("p", { className: `assignment-\
status assignment-status--${Qe.kind}`, role: Qe.kind === "error" ? "alert" : "status", children: Qe.message }) : null] }), a("form", { className: "architect-han\
doff-form", onSubmit: async (t) => {
    t.preventDefault();
    const n = ie.reason.trim();
    if (!n) {
      mt({ kind: "error", message: "A reassignment reason is required." });
      return;
    }
    try {
      mt({ kind: "loading", message: "Reassigning task\u2026" }), await p.reassignTask(g, { mode: ie.mode, reason: n, assignee: ie.assignee.trim() || void 0, engineerTier: ie.
      engineerTier.trim() || void 0 }), await k(), mt({ kind: "success", message: ie.mode === "inactivity" ? "Task reassigned and inactivity review created." : "\
Task reassigned." });
    } catch (r) {
      mt({ kind: "error", message: r.message || "Reassignment failed." });
    }
  }, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { children: ["Reassignment mode", a("select", { value: ie.mode,
  onChange: (t) => ut((n) => ({ ...n, mode: t.target.value })), children: [e("option", { value: "inactivity", children: "Inactivity review" }), e("option", { value: "\
above_skill", children: "Responsible escalation" }), e("option", { value: "manual", children: "Manual" })] })] }), a("label", { children: ["New assignee", e("in\
put", { value: ie.assignee, onChange: (t) => ut((n) => ({ ...n, assignee: t.target.value })), placeholder: "engineer" })] }), a("label", { children: ["Target en\
gineer tier", e("input", { value: ie.engineerTier, onChange: (t) => ut((n) => ({ ...n, engineerTier: t.target.value })), placeholder: "Sr" })] }), a("label", { className: "\
architect-handoff-grid__full", children: ["Reassignment reason", e("textarea", { value: ie.reason, onChange: (t) => ut((n) => ({ ...n, reason: t.target.value })),
  placeholder: "Explain why ownership is moving and what the new assignee should know." })] })] }), e("div", { className: "assignment-form__actions", children: e(
  "button", { type: "submit", disabled: Fe.kind === "loading", children: Fe.kind === "loading" ? "Submitting\u2026" : "Reassign task" }) }), Fe.kind !== "idle" ?
  e("p", { className: `assignment-status assignment-status--${Fe.kind}`, role: Fe.kind === "error" ? "alert" : "status", children: Fe.message }) : null] })] }) :
  e("p", { className: "assignment-status", role: "status", children: "Re-tiering and reassignment controls are available to architect/admin bearer tokens." }), yn ?
  a("form", { className: "architect-handoff-form", onSubmit: async (t) => {
    if (t.preventDefault(), !Re) {
      Me({ kind: "error", message: "Implementation metadata can only be submitted while the task is in implementation." });
      return;
    }
    if (!me.isValid) {
      Me({ kind: "error", message: me.missingAll ? "Provide a commit SHA, a GitHub PR URL, or both before handing off to QA." : "Fix the invalid implementation \
reference format before submitting." });
      return;
    }
    try {
      Me({ kind: "loading", message: "Submitting implementation metadata\u2026" }), await p.submitEngineerSubmission(g, { commitSha: me.commitSha, prUrl: me.prUrl }),
      await k(), Me({ kind: "success", message: "Implementation metadata submitted." });
    } catch (n) {
      Me({ kind: "error", message: n.message || "Implementation metadata submission failed." });
    }
  }, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { children: ["Commit SHA", e("input", { value: fa.commitSha, onChange: (t) => ya(
  (n) => ({ ...n, commitSha: t.target.value })), placeholder: "7-40 hex characters", "aria-describedby": "engineer-submission-commit-help" }), e("small", { id: "\
engineer-submission-commit-help", children: "Accepted format: 7-40 hexadecimal characters from local git." })] }), a("label", { children: ["GitHub PR URL", e("i\
nput", { value: fa.prUrl, onChange: (t) => ya((n) => ({ ...n, prUrl: t.target.value })), placeholder: "https://github.com/owner/repo/pull/123", "aria-describedb\
y": "engineer-submission-pr-help" }), e("small", { id: "engineer-submission-pr-help", children: "Accepted format: full GitHub pull request URL. Optional if a co\
mmit SHA is provided." })] }), a("div", { className: "architect-handoff-grid__full implementation-preview", "aria-live": "polite", children: [e("span", { className: "\
implementation-preview__label", children: "QA handoff preview" }), e("strong", { children: me.primaryReference || "A primary implementation reference is require\
d before QA handoff." }), e("p", { children: me.missingAll ? "Provide a commit SHA, a GitHub PR URL, or both. The first available reference becomes the auditabl\
e primary implementation reference." : me.invalidFields.length ? "Fix the highlighted format issue before submission. Accepted formats are shown below each fiel\
d." : "This reference will be recorded in audit history and used as the implementation handoff to QA." })] })] }), Re ? null : e("p", { className: "assignment-s\
tatus", role: "status", children: "Implementation metadata can only be submitted while the task is in implementation." }), me.invalidFields.includes("commitSha") ?
  e("p", { className: "assignment-status assignment-status--error", role: "alert", children: "Commit SHA must be 7-40 hexadecimal characters." }) : null, me.invalidFields.
  includes("prUrl") ? e("p", { className: "assignment-status assignment-status--error", role: "alert", children: "GitHub PR URL must look like `https://github.c\
om/<owner>/<repo>/pull/<number>`." }) : null, e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: Be.kind === "l\
oading" || !Re, children: Be.kind === "loading" ? "Submitting\u2026" : "Submit implementation handoff" }) }), Be.kind !== "idle" ? e("p", { className: `assignme\
nt-status assignment-status--${Be.kind}`, role: Be.kind === "error" ? "alert" : "status", children: Be.message }) : null] }) : e("p", { className: "assignment-s\
tatus", role: "status", children: "Implementation handoff controls are available to engineer/admin bearer tokens." }), e("h3", { children: "Linked delivery arti\
facts" }), Pa.canViewLinkedPrMetadata === false ? e("p", { children: "Linked PR metadata is hidden for this session." }) : s.detail?.relations?.linkedPrs?.length ?
  e("ul", { className: "detail-bullets", children: s.detail.relations.linkedPrs.map((t) => a("li", { children: [e("strong", { children: t.title }), a("span", { children: [
  t.number ? ` \xB7 #${t.number}` : "", t.repository ? ` \xB7 ${t.repository}` : "", t.state ? ` \xB7 ${t.state}` : "", t.merged ? " \xB7 merged" : "", t.draft ?
  " \xB7 draft" : ""] })] }, t.id)) }) : e("p", { children: "No linked PRs yet." }), s.detail?.context?.executionContract?.artifacts?.links?.length ? e("ul", { className: "\
detail-bullets", children: s.detail.context.executionContract.artifacts.links.map((t) => a("li", { children: [e("strong", { children: t.label }), e("a", { href: `\
/${t.path}`, children: t.path })] }, t.rel || t.path)) }) : null, s.detail?.context?.executionContract?.verificationReport?.links?.length ? e("ul", { className: "\
detail-bullets", children: s.detail.context.executionContract.verificationReport.links.map((t) => a("li", { children: [e("strong", { children: t.label }), e("a",
  { href: `/${t.path}`, children: t.path })] }, t.rel || t.path)) }) : null, be?.active ? a("div", { className: "review-question-note", children: [e("span", { children: "\
Contract Coverage Audit" }), e("p", { children: be.validation?.status || be.latest?.status || "submitted" }), e("p", { children: be.readiness?.summary || be.validation?.
  summary }), be.validation?.markdown?.path ? e("a", { href: `/${be.validation.markdown.path}`, children: be.validation.markdown.path }) : null] }) : null, s.detail?.
  context?.executionContract?.artifacts?.pr_guidance ? a("div", { className: "review-question-note", children: [e("span", { children: "PR guidance" }), e("p", {
  children: s.detail.context.executionContract.artifacts.pr_guidance.title })] }) : null, Nt?.approved_by_policy ? a("div", { className: "review-question-note",
  children: [e("span", { children: "Auto-approval policy" }), e("p", { children: Nt.policy_version }), e("p", { children: Nt.rationale }), e("p", { children: Nt.
  approved_at || Nt.approvedAt })] }) : null, s.detail?.relations?.parentTask ? a(q, { children: [e("h3", { children: "Linked parent task" }), e("ul", { className: "\
detail-bullets", children: a("li", { children: [e("strong", { children: s.detail.relations.parentTask.title }), a("span", { children: [s.detail.relations.parentTask.
  stage || "No stage", " \xB7 ", rt(s.detail.relations.parentTask.status), " \xB7 ", s.detail.relations.parentTask.owner?.label || "Unassigned"] })] }, s.detail.
  relations.parentTask.id) })] }) : null, Pa.canViewChildTasks === false ? e("p", { children: "Child task relationships are hidden for this session." }) : s.detail?.
  relations?.childTasks?.length ? e("ul", { className: "detail-bullets", children: s.detail.relations.childTasks.map((t) => a("li", { children: [e("strong", { children: t.
  title }), a("span", { children: [t.stage || "No stage", " \xB7 ", rt(t.status), " \xB7 ", t.owner?.label || "Unassigned"] })] }, t.id)) }) : e("p", { children: "\
No child tasks linked yet." }), s.detail?.context?.anomalyChildTask ? a("div", { className: "review-question-note", children: [e("span", { children: "Machine-ge\
nerated anomaly context" }), e("p", { children: s.detail.context.anomalyChildTask.summary || "No anomaly summary captured." }), a("p", { className: "task-list-m\
eta", children: [s.detail.context.anomalyChildTask.service || "Unknown service", " \xB7 Source parent: ", s.detail.context.anomalyChildTask.sourceTaskId || "Una\
vailable"] })] }) : null] }), a("section", { id: "task-detail-architect-review-section", className: "detail-card detail-card--full", children: [e("h2", { children: "Architect review questions" }), a("div",
  { className: "summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "Total threads" }), e("strong", { children: s.
  detail?.reviewQuestions?.summary?.total ?? 0 })] }), a("article", { children: [e("span", { children: "Open" }), e("strong", { children: s.detail?.reviewQuestions?.
  summary?.unresolvedCount ?? 0 })] }), a("article", { children: [e("span", { children: "Blocking" }), e("strong", { children: s.detail?.reviewQuestions?.summary?.
  unresolvedBlockingCount ?? 0 })] }), a("article", { children: [e("span", { children: "Resolved" }), e("strong", { children: s.detail?.reviewQuestions?.summary?.
  resolvedCount ?? 0 })] })] }), Is ? a("form", { className: "review-question-composer", onSubmit: async (t) => {
    t.preventDefault();
    const r = new FormData(t.currentTarget), n = String(r.get("reviewQuestionPrompt") ?? tn).trim(), o = r.has("reviewQuestionBlocking");
    if (!n) {
      Ue({ kind: "error", message: "Review question prompt is required.", questionId: null, action: "ask" });
      return;
    }
    await ra({ action: "ask", payload: { prompt: n, blocking: o }, successMessage: "Architect review question created." });
  }, children: [a("label", { children: ["New architect review question", e("textarea", { name: "reviewQuestionPrompt", value: tn, onChange: (t) => an(t.target.value), placeholder: "What deci\
sion or PM clarification is needed before architect review can proceed?" })] }), a("label", { className: "review-question-checkbox", children: [e("input", { type: "\
checkbox", name: "reviewQuestionBlocking", checked: nn, onChange: (t) => sn(t.target.checked) }), "Blocks architect handoff until PM resolves it"] }), e("div", { className: "review-question-co\
mposer__actions", children: e("button", { type: "submit", disabled: ee.kind === "loading" && ee.action === "ask", children: ee.kind === "loading" && ee.action ===
  "ask" ? "Saving\u2026" : "Ask question" }) })] }) : null, ee.kind !== "idle" ? e("p", { className: `review-question-status review-question-status--${ee.kind}`,
  role: ee.kind === "error" ? "alert" : "status", children: ee.message }) : null, s.detail?.reviewQuestions?.items?.length ? e("div", { className: "review-quest\
ion-thread-list", children: s.detail.reviewQuestions.items.map((t) => {
    const n = vs[t.id] || "", r = ee.kind === "loading" && ee.questionId === t.id;
    return a("article", { className: "review-question-thread", children: [a("div", { className: "review-question-thread__header", children: [a("div", { children: [
    a("div", { className: "review-question-thread__badges", children: [e("span", { className: `review-question-badge review-question-badge--${t.state}`, children: Qn(
    t.state) }), t.blocking ? e("span", { className: "review-question-badge review-question-badge--blocking", children: "Blocking" }) : e("span", { className: "\
review-question-badge review-question-badge--nonblocking", children: "Non-blocking" })] }), e("h3", { children: t.prompt })] }), a("dl", { className: "review-qu\
estion-meta", children: [a("div", { children: [e("dt", { children: "Created" }), e("dd", { children: t.createdAt || "\u2014" })] }), a("div", { children: [e("dt",
    { children: "Updated" }), e("dd", { children: t.lastUpdatedAt || "\u2014" })] }), a("div", { children: [e("dt", { children: "Owner" }), e("dd", { children: t.
    createdBy || "Unknown" })] })] })] }), t.answer ? a("div", { className: "review-question-note", children: [e("span", { children: "PM answer" }), e("p", { children: t.
    answer })] }) : null, t.resolution ? a("div", { className: "review-question-note review-question-note--resolution", children: [e("span", { children: "Resolu\
tion" }), e("p", { children: t.resolution })] }) : null, t.messages?.length ? e("ul", { className: "review-question-history", children: t.messages.map((d) => a(
    "li", { children: [e("strong", { children: Eo(d.eventType) }), a("span", { children: [d.actorId || "Unknown actor", " \xB7 ", d.occurredAt || "No timestamp"] }),
    d.body ? e("p", { children: d.body }) : null] }, d.id)) }) : null, Nn || Cn || Sn && t.state === "resolved" ? a("form", { className: "review-question-thread\
__actions", onSubmit: (d) => d.preventDefault(), children: [a("label", { children: [t.state === "resolved" ? "Reopen note" : "PM response / resolution note", e(
    "textarea", { value: n, onChange: (d) => js(t.id, d.target.value), placeholder: t.state === "resolved" ? "Explain why architect review needs another pass." :
    "Capture the PM answer or resolution note." })] }), a("div", { className: "review-question-thread__buttons", children: [Nn && t.state !== "resolved" ? e("bu\
tton", { type: "button", disabled: r, onClick: () => {
      const d = n.trim();
      if (!d) {
        Ue({ kind: "error", message: "Review question answer is required.", questionId: t.id, action: "answer" });
        return;
      }
      ra({ action: "answer", questionId: t.id, payload: { body: d }, successMessage: "Review question answered." });
    }, children: "Answer" }) : null, Cn && t.state !== "resolved" ? e("button", { type: "button", className: "button-secondary", disabled: r, onClick: () => ra(
    { action: "resolve", questionId: t.id, payload: { resolution: n.trim() || "Resolved from task detail UI." }, successMessage: "Review question resolved." }),
    children: "Resolve" }) : null, Sn && t.state === "resolved" ? e("button", { type: "button", className: "button-secondary", disabled: r, onClick: () => ra({ action: "\
reopen", questionId: t.id, payload: { reason: n.trim() || "Reopened from task detail UI." }, successMessage: "Review question reopened." }), children: "Reopen" }) :
    null] })] }) : null] }, t.id);
  }) }) : e("p", { children: "No architect review questions recorded yet." })] }), a("section", { id: "task-detail-discussion-section", className: "detail-card", children: [e("h2", { children: "Disc\
ussion" }), a("div", { className: "summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "Total threads" }), e(
  "strong", { children: aa.total })] }), a("article", { children: [e("span", { children: "Open" }), e("strong", { children: aa.unresolvedCount })] }), a("articl\
e", { children: [e("span", { children: "Blocking" }), e("strong", { children: aa.unresolvedBlockingCount })] }), a("article", { children: [e("span", { children: "\
Resolved" }), e("strong", { children: aa.resolvedCount })] })] }), xn ? a("form", { className: "review-question-composer", onSubmit: (t) => {
    t.preventDefault(), la({ action: "create", payload: oe, successMessage: "Workflow thread created." });
  }, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { children: ["Thread type", e("select", { value: oe.commentType,
  onChange: (t) => ze((n) => ({ ...n, commentType: t.target.value })), children: On.map((t) => e("option", { value: t.value, children: t.label }, t.value)) })] }),
  a("label", { children: ["Linked workflow event ID", e("input", { value: oe.linkedEventId, onChange: (t) => ze((n) => ({ ...n, linkedEventId: t.target.value })),
  placeholder: "Optional audit event id" })] }), a("label", { className: "architect-handoff-grid__full", children: ["Thread title", e("input", { value: oe.title,
  onChange: (t) => ze((n) => ({ ...n, title: t.target.value })), placeholder: "Short summary of the question, escalation, or decision" })] }), a("label", { className: "\
architect-handoff-grid__full", children: ["Thread body", e("textarea", { value: oe.body, onChange: (t) => ze((n) => ({ ...n, body: t.target.value })), placeholder: "\
Capture the typed workflow context in a structured, auditable way." })] })] }), a("label", { className: "review-question-checkbox", children: [e("input", { type: "\
checkbox", checked: oe.blocking, onChange: (t) => ze((n) => ({ ...n, blocking: t.target.checked })) }), "Pin this thread near the top of task detail until it is\
 resolved"] }), a("div", { className: "review-question-note", children: [e("span", { children: "Notification routing" }), e("p", { children: oe.blocking ? "Bloc\
king threads notify the people who can unblock the work first." : "Advisory threads keep the most relevant workflow roles in the loop." }), a("p", { className: "\
task-list-meta", children: ["Targets: ", Ls.map(ds).join(" \xB7 ")] })] }), e("div", { className: "review-question-composer__actions", children: e("button", { type: "\
submit", disabled: te.kind === "loading" && te.action === "create", children: te.kind === "loading" && te.action === "create" ? "Saving\u2026" : "Create thread" }) })] }) :
  null, te.kind !== "idle" ? e("p", { className: `review-question-status review-question-status--${te.kind}`, role: te.kind === "error" ? "alert" : "status", children: te.
  message }) : null, ta.length ? e("div", { className: "review-question-thread-list", children: ta.map((t) => {
    const n = ks[t.id] || "", r = te.kind === "loading" && te.threadId === t.id, d = !!hs[t.id], m = d ? t.messages || [] : (t.messages || []).slice(0, 2);
    return a("article", { className: "review-question-thread", children: [a("div", { className: "review-question-thread__header", children: [a("div", { children: [
    a("div", { className: "review-question-thread__badges", children: [e("span", { className: `review-question-badge review-question-badge--${t.state}`, children: t.
    state === "resolved" ? "Resolved" : "Open" }), e("span", { className: `review-question-badge review-question-badge--type-${t.commentType}`, children: ls(t.commentType) }),
    t.blocking ? e("span", { className: "review-question-badge review-question-badge--blocking", children: "Blocking" }) : null] }), e("h3", { children: t.title })] }),
    a("dl", { className: "review-question-meta", children: [a("div", { children: [e("dt", { children: "Created" }), e("dd", { children: t.createdAt || "\u2014" })] }),
    a("div", { children: [e("dt", { children: "Updated" }), e("dd", { children: t.lastUpdatedAt || "\u2014" })] }), a("div", { children: [e("dt", { children: "O\
wner" }), e("dd", { children: t.createdBy || "Unknown" })] })] })] }), a("div", { className: "review-question-note", children: [e("span", { children: "Thread co\
ntext" }), e("p", { children: t.body }), t.linkedEventId ? a("p", { className: "task-list-meta", children: ["Linked workflow event: ", t.linkedEventId] }) : null,
    a("p", { className: "task-list-meta", children: ["Notification targets: ", (t.notificationTargets?.length ? t.notificationTargets : cs(t.commentType, t.blocking)).
    map(ds).join(" \xB7 ")] })] }), t.messages?.length ? e("ul", { className: "review-question-history", children: m.map((v) => a("li", { children: [e("strong",
    { children: v.actorId || "Unknown actor" }), e("span", { children: v.occurredAt || "No timestamp" }), v.body ? e("p", { children: v.body }) : null] }, v.id)) }) :
    null, t.messages?.length > 2 ? e("button", { type: "button", className: "thread-toggle", onClick: () => Ks(t.id), children: d ? "Collapse thread history" : `\
Show ${t.messages.length - 2} older thread updates` }) : null, xn ? a("form", { className: "review-question-thread__actions", onSubmit: (v) => v.preventDefault(),
    children: [a("label", { children: [t.state === "resolved" ? "Reopen note" : "Reply / resolution note", e("textarea", { value: n, onChange: (v) => Vs(t.id, v.
    target.value), placeholder: t.state === "resolved" ? "Explain why the thread needs another pass." : "Add a reply or capture the resolution note." })] }), e(
    "div", { className: "review-question-thread__buttons", children: t.state !== "resolved" ? a(q, { children: [e("button", { type: "button", disabled: r, onClick: () => la(
    { action: "reply", threadId: t.id, payload: { body: n.trim() }, successMessage: "Workflow thread updated." }), children: "Reply" }), e("button", { type: "bu\
tton", className: "button-secondary", disabled: r, onClick: () => la({ action: "resolve", threadId: t.id, payload: { resolution: n.trim() || "Resolved from task\
 detail UI." }, successMessage: "Workflow thread resolved." }), children: "Resolve" })] }) : e("button", { type: "button", className: "button-secondary", disabled: r,
    onClick: () => la({ action: "reopen", threadId: t.id, payload: { body: n.trim() || "Reopened from task detail UI." }, successMessage: "Workflow thread reope\
ned." }), children: "Reopen" }) })] }) : null] }, t.id);
  }) }) : Pa.canViewComments === false ? e("p", { children: "Workflow comments are hidden for this session." }) : e("p", { children: "No structured workflow thr\
eads yet." })] }), a("section", { id: "task-detail-qa-section", className: "detail-card", children: [e("h2", { children: "QA" }), a("div", { className: "summary-grid review-question-summary-\
grid", children: [a("article", { children: [e("span", { children: "Total runs" }), e("strong", { children: s.detail?.context?.qaResults?.summary?.total ?? 0 })] }),
  a("article", { children: [e("span", { children: "Passed" }), e("strong", { children: s.detail?.context?.qaResults?.summary?.passedCount ?? 0 })] }), a("articl\
e", { children: [e("span", { children: "Failed" }), e("strong", { children: s.detail?.context?.qaResults?.summary?.failedCount ?? 0 })] }), a("article", { children: [
  e("span", { children: "Re-tests" }), e("strong", { children: s.detail?.context?.qaResults?.summary?.retestCount ?? 0 })] })] }), st ? a("div", { className: "r\
eview-question-note", children: [e("span", { children: "Latest QA result" }), e("p", { children: st.summary }), a("p", { className: "task-list-meta", children: [
  st.outcome === "pass" ? "Passed" : "Failed", st.runKind === "retest" ? " \xB7 Re-test" : " \xB7 Initial run", st.implementationReference?.label ? ` \xB7 ${st.
  implementationReference.label}` : ""] })] }) : e("p", { children: "No QA result has been recorded yet." }), Ps ? a("form", { className: "architect-handoff-for\
m", onSubmit: Xs, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { children: ["Outcome", a("select", { value: R.outcome,
  onChange: (t) => re((n) => ({ ...n, outcome: t.target.value })), children: [e("option", { value: "fail", children: "Fail back to implementation" }), e("option",
  { value: "pass", children: "Pass to SRE monitoring" })] })] }), a("label", { className: "architect-handoff-grid__full", children: ["QA summary", e("textarea",
  { value: R.summary, onChange: (t) => re((n) => ({ ...n, summary: t.target.value })), placeholder: "Summarize the test outcome and the most important signal." })] }),
  a("label", { children: ["Scenarios", e("textarea", { value: R.scenarios, onChange: (t) => re((n) => ({ ...n, scenarios: t.target.value })), placeholder: "One \
scenario per line" })] }), a("label", { children: ["Findings", e("textarea", { value: R.findings, onChange: (t) => re((n) => ({ ...n, findings: t.target.value })),
  placeholder: "One finding per line" })] }), a("label", { children: ["Reproduction steps", e("textarea", { value: R.reproductionSteps, onChange: (t) => re((n) => ({
  ...n, reproductionSteps: t.target.value })), placeholder: "One reproduction step per line" })] }), a("label", { children: ["Re-test scope", e("textarea", { value: R.
  retestScope, onChange: (t) => re((n) => ({ ...n, retestScope: t.target.value })), placeholder: "Optional scoped re-test plan" })] }), a("label", { children: [
  "Stack traces", e("textarea", { value: R.stackTraces, onChange: (t) => re((n) => ({ ...n, stackTraces: t.target.value })), placeholder: "One stack trace summa\
ry per line" })] }), a("label", { children: ["Environment logs", e("textarea", { value: R.envLogs, onChange: (t) => re((n) => ({ ...n, envLogs: t.target.value })),
  placeholder: "One log summary per line" })] })] }), a("div", { className: "review-question-note", children: [e("span", { children: "Route preview" }), e("p", {
  children: R.outcome === "pass" ? "A passing result routes this task forward to SRE monitoring." : "A failing result routes this task back to the implementatio\
n fix loop with a packaged escalation." }), a("p", { className: "task-list-meta", children: ["Next stage: ", Gs] }), ia ? a("p", { className: "task-list-meta", children: [
  "Scoped re-test for run ", ia.priorRunId, " stays with ", ia.priorQaActorId || "the previous QA owner", " and should cover ", ia.scope.join(", ") || "the prio\
r failing scenarios", "."] }) : null] }), Ua.length ? a("p", { className: "assignment-status assignment-status--error", role: "alert", children: ["Missing failu\
re context: ", Ua.join(", "), "."] }) : null, e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: We.kind === "l\
oading" || Ua.length > 0, children: We.kind === "loading" ? "Submitting\u2026" : "Submit QA result" }) }), We.kind !== "idle" ? e("p", { className: `assignment-\
status assignment-status--${We.kind}`, role: We.kind === "error" ? "alert" : "status", children: We.message }) : null] }) : null, s.detail?.context?.qaResults?.
  items?.length ? e("ul", { className: "detail-feed", children: s.detail.context.qaResults.items.map((t) => a("li", { children: [a("strong", { children: [t.outcome ===
  "pass" ? "Pass" : "Fail", t.runKind === "retest" ? " \xB7 Re-test" : ""] }), a("span", { children: [t.submittedBy || "Unknown QA", " \xB7 ", t.submittedAt || "\
No timestamp"] }), e("p", { children: t.summary }), t.escalationPackage ? a(q, { children: [a("p", { className: "task-list-meta", children: ["Escalation target:\
 ", t.escalationPackage.routing?.recipient_agent_id || t.escalationPackage.routing?.recipient_role || "engineer", " \xB7 Required tier: ", t.escalationPackage.routing?.
  required_engineer_tier || "\u2014"] }), a("div", { className: "qa-package", children: [e("strong", { children: "Escalation package" }), e("p", { className: "t\
ask-list-meta", children: "Reproduction steps come first, then failing scenarios, findings, and condensed logs/traces." }), t.escalationPackage.notification_preview ?
  a("div", { className: "qa-package__section", children: [e("span", { children: "Notification preview" }), e("p", { children: t.escalationPackage.notification_preview.
  headline }), a("p", { className: "task-list-meta", children: ["Route: ", t.escalationPackage.notification_preview.recipient_agent_id || t.escalationPackage.notification_preview.
  recipient_role || "engineer", t.escalationPackage.notification_preview.required_engineer_tier ? ` \xB7 Required tier: ${t.escalationPackage.notification_preview.
  required_engineer_tier}` : ""] }), F(t.escalationPackage.notification_preview.highlights, "No notification highlights captured.")] }) : null, a("div", { className: "\
qa-package__section", children: [e("span", { children: "Reproduction steps" }), F(t.escalationPackage.reproduction_steps, "No reproduction steps captured.")] }),
  a("div", { className: "qa-package__section", children: [e("span", { children: "Failing scenarios" }), F(t.escalationPackage.failing_scenarios, "No failing sce\
narios captured.")] }), a("div", { className: "qa-package__section", children: [e("span", { children: "Findings" }), F(t.escalationPackage.findings, "No finding\
s captured.")] }), e("button", { type: "button", className: "thread-toggle", onClick: () => Js(t.runId), children: un[t.runId] ? "Hide logs and traces" : "Show \
logs and traces" }), un[t.runId] ? a("div", { className: "qa-package__expanded", children: [a("div", { className: "qa-package__section", children: [e("span", { children: "\
Stack traces" }), F(t.escalationPackage.stack_traces, "No stack traces captured.")] }), a("div", { className: "qa-package__section", children: [e("span", { children: "\
Environment logs" }), F(t.escalationPackage.env_logs, "No environment logs captured.")] }), a("div", { className: "qa-package__section", children: [e("span", { children: "\
Escalation chain" }), e("p", { children: (t.escalationPackage.routing?.escalation_chain || []).join(" -> ") || "No escalation chain captured." })] }), a("div", {
  className: "qa-package__section", children: [e("span", { children: "Previous fix history" }), t.escalationPackage.previous_fix_history?.length ? e("ul", { className: "\
detail-feed", children: t.escalationPackage.previous_fix_history.map((n) => a("li", { children: [a("strong", { children: ["v", n.version, " \xB7 ", n.primary_reference?.
  label || n.commit_sha || n.pr_url || "Reference missing"] }), a("span", { children: [n.submitted_by || "Unknown engineer", " \xB7 ", n.submitted_at || "No tim\
estamp"] })] }, `${t.runId}-${n.version}`)) }) : e("p", { className: "empty-copy", children: "No previous fix history captured." })] })] }) : null] })] }) : null] },
  t.runId)) }) : null] }), a("section", { id: "task-detail-sre-section", className: "detail-card", children: [e("h2", { children: "SRE Monitoring" }), w ? a(q, { children: [a("div", { className: "\
summary-grid review-question-summary-grid", children: [a("article", { children: [e("span", { children: "State" }), e("strong", { children: w.state })] }), a("ar\
ticle", { children: [e("span", { children: "Risk" }), e("strong", { children: w.riskLevel || "unknown" })] }), a("article", { children: [e("span", { children: "\
Time remaining" }), e("strong", { children: w.timeRemainingLabel || "Not started" })] }), a("article", { children: [e("span", { children: "Telemetry freshness" }),
  e("strong", { children: w.telemetry?.freshness || "unknown" })] })] }), a("div", { className: "review-question-note", children: [e("span", { children: "Deploy\
ment snapshot" }), e("p", { children: w.deployment?.environment ? `${w.deployment.environment} \xB7 ${w.deployment.version || "version unknown"}` : "Monitoring \
has not started yet." }), a("p", { className: "task-list-meta", children: ["PR: ", w.linkedPrs?.[0]?.number ? `#${w.linkedPrs[0].number}` : "None", ` \xB7 Commit: ${w.
  commitSha || "None"}`, w.windowEndsAt ? ` \xB7 Window ends: ${w.windowEndsAt}` : ""] }), a("p", { className: "task-list-meta", children: [w.telemetry?.drilldowns?.
  metrics ? e("a", { href: w.telemetry.drilldowns.metrics, target: "_blank", rel: "noreferrer", children: "Metrics" }) : "Metrics unavailable", " \xB7 ", w.telemetry?.
  drilldowns?.logs ? e("a", { href: w.telemetry.drilldowns.logs, target: "_blank", rel: "noreferrer", children: "Logs" }) : "Logs unavailable", " \xB7 ", w.telemetry?.
  drilldowns?.traces ? e("a", { href: w.telemetry.drilldowns.traces, target: "_blank", rel: "noreferrer", children: "Traces" }) : "Traces unavailable"] })] }), w.
  approval ? a("div", { className: "review-question-note", children: [e("span", { children: "Recorded approval" }), e("p", { children: w.approval.reason }), a("\
p", { className: "task-list-meta", children: [w.approval.approvedBy || "Unknown approver", " \xB7 ", w.approval.approvedAt || "No timestamp"] }), F(w.approval.evidence,
  "No evidence notes captured.")] }) : null, w.escalation ? a("div", { className: "review-question-note", children: [e("span", { children: "Expiry escalation" }),
  e("p", { children: "Human stakeholder escalation was created because the monitoring window expired without approval." }), e("p", { className: "task-list-meta",
  children: w.escalation.escalatedAt || "No timestamp" })] }) : null, qs ? a("form", { className: "architect-handoff-form", onSubmit: ti, children: [a("div", { className: "\
review-question-note", children: [e("span", { children: "Create child task from anomaly" }), e("p", { children: "These fields are prefilled from monitoring cont\
ext and remain editable before the child task is created." }), e("p", { className: "task-list-meta", children: "This defaults the child to P0, links it to the p\
arent, blocks the parent, and routes the child back to PM business-context review." })] }), a("div", { className: "summary-grid architect-handoff-grid", children: [
  a("label", { children: ["Child task title", e("input", { value: Q.title, onChange: (t) => Se((n) => ({ ...n, title: t.target.value })), placeholder: "Investig\
ate checkout-api anomaly for TSK-123" })] }), a("label", { children: ["Affected service", e("input", { value: Q.service, onChange: (t) => Se((n) => ({ ...n, service: t.
  target.value })), placeholder: "checkout-api" })] }), a("label", { className: "architect-handoff-grid__full", children: ["Anomaly summary", e("textarea", { value: Q.
  anomalySummary, onChange: (t) => Se((n) => ({ ...n, anomalySummary: t.target.value })), placeholder: "Describe the production anomaly that should become track\
ed work." })] }), a("label", { children: ["Metrics", e("textarea", { value: Q.metrics, onChange: (t) => Se((n) => ({ ...n, metrics: t.target.value })), placeholder: "\
One metric signal per line" })] }), a("label", { children: ["Logs", e("textarea", { value: Q.logs, onChange: (t) => Se((n) => ({ ...n, logs: t.target.value })),
  placeholder: "One log sample or drilldown per line" })] }), a("label", { children: ["Error samples", e("textarea", { value: Q.errorSamples, onChange: (t) => Se(
  (n) => ({ ...n, errorSamples: t.target.value })), placeholder: "One error sample or trace per line" })] })] }), e("div", { className: "assignment-form__action\
s", children: e("button", { type: "submit", disabled: Ke.kind === "loading", children: Ke.kind === "loading" ? "Creating\u2026" : "Create anomaly child task" }) }),
  Ke.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${Ke.kind}`, role: Ke.kind === "error" ? "alert" : "status", children: Ke.message }) :
  null] }) : null, na && w.canStart ? a("form", { className: "architect-handoff-form", onSubmit: Zs, children: [a("div", { className: "summary-grid architect-ha\
ndoff-grid", children: [a("label", { children: ["Deployment environment", e("input", { value: le.deploymentEnvironment, onChange: (t) => pt((n) => ({ ...n, deploymentEnvironment: t.
  target.value })) })] }), a("label", { children: ["Deployment URL", e("input", { value: le.deploymentUrl, onChange: (t) => pt((n) => ({ ...n, deploymentUrl: t.
  target.value })), placeholder: "https://deploy.example/releases/123" })] }), a("label", { children: ["Deployment version", e("input", { value: le.deploymentVersion,
  onChange: (t) => pt((n) => ({ ...n, deploymentVersion: t.target.value })), placeholder: "2026.04.14-1" })] }), a("label", { className: "architect-handoff-grid\
__full", children: ["Deployment evidence", e("textarea", { value: le.evidence, onChange: (t) => pt((n) => ({ ...n, evidence: t.target.value })), placeholder: "O\
ne confirmation per line" })] })] }), e("div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: je.kind === "loading",
  children: je.kind === "loading" ? "Starting\u2026" : "Start monitoring window" }) }), je.kind !== "idle" ? e("p", { className: `assignment-status assignment-s\
tatus--${je.kind}`, role: je.kind === "error" ? "alert" : "status", children: je.message }) : null] }) : null, na && w.canApprove ? a("form", { className: "arch\
itect-handoff-form", onSubmit: ei, children: [a("div", { className: "summary-grid architect-handoff-grid", children: [a("label", { className: "architect-handoff\
-grid__full", children: ["Approval reason", e("textarea", { value: gt.reason, onChange: (t) => Ca((n) => ({ ...n, reason: t.target.value })), placeholder: "Expl\
ain why the rollout is stable enough to leave SRE monitoring early." })] }), a("label", { className: "architect-handoff-grid__full", children: ["Evidence notes",
  e("textarea", { value: gt.evidence, onChange: (t) => Ca((n) => ({ ...n, evidence: t.target.value })), placeholder: "One evidence note per line" })] })] }), e(
  "div", { className: "assignment-form__actions", children: e("button", { type: "submit", disabled: Ve.kind === "loading", children: Ve.kind === "loading" ? "Ap\
proving\u2026" : "Approve early" }) }), Ve.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${Ve.kind}`, role: Ve.kind === "error" ? "\
alert" : "status", children: Ve.message }) : null] }) : null, na && !w.canApprove && s.detail?.summary?.blockedState?.isBlocked ? a("div", { className: "review-\
question-note", children: [e("span", { children: "Approval paused" }), e("p", { children: "The parent task is blocked by linked anomaly investigation work." }),
  e("p", { className: "task-list-meta", children: "Comments and review remain available, but stage progression stays paused until the child task is resolved or \
unblocked." })] }) : null] }) : e("p", { children: "No SRE monitoring context yet." })] }), a("section", { id: "task-detail-history-section", className: "detail-card", children: [e("h2", { children: "\
History" }), a("p", { className: "task-list-meta", children: ["Telemetry: ", s.detail?.telemetry?.availability || "unknown", s.detail?.telemetry?.lastUpdatedAt ?
  ` \xB7 ${s.detail.telemetry.lastUpdatedAt}` : ""] }), e(Ni, { selectedTab: s.shell.selectedTab, onTabChange: Ns, historyState: s.shell.historyState, telemetryState: s.
  shell.telemetryState, historyItems: s.shell.historyItems, telemetryCards: s.shell.telemetryCards, filters: s.shell.filters, onFiltersChange: Cs, historyPageInfo: s.
  shell.historyPageInfo, onLoadMoreHistory: Ws, isLoadingMoreHistory: ba.kind === "loading", historyLoadMoreError: ba.kind === "error" ? ba.message : "" })] })] }),
  oa ? null : e(Ci, { currentStage: s.summary.currentStage || "BACKLOG", taskId: g, onTransition: async (t, n) => {
    try {
      await p.changeTaskStage(g, t, n), await k();
    } catch (r) {
      throw r;
    }
  } }), oa ? null : a("section", { id: "task-detail-assignment-panel", className: "assignment-panel", "aria-label": "Task assignment", children: [e("div", { className: "assignment-panel__header", children: a(
  "div", { children: [e("p", { className: "eyebrow", children: "Assignment" }), e("h2", { children: "Assign AI agent owner" }), e("p", { className: "lede", children: "\
Writes to the task assignment endpoint and refreshes the projected owner after success." })] }) }), _s ? a("form", { className: "assignment-form", onSubmit: async (t) => {
    if (t.preventDefault(), !!s.route?.taskId) try {
      Ut({ kind: "loading", message: "Saving assignment\u2026" }), await p.assignTaskOwner(s.route.taskId, Et || null), await k(), Ut({ kind: "success", message: Et ?
      `Assigned to ${Et}.` : "Assignment cleared." });
    } catch (n) {
      Ut({ kind: "error", message: n.message || "Assignment update failed." });
    }
  }, children: [a("label", { children: ["Owner", a("select", { value: Et, onChange: (t) => en(t.target.value), children: [e("option", { value: "", children: "Un\
assigned" }), Ne.map((t) => a("option", { value: t.id, children: [t.display_name, t.role ? ` \xB7 ${t.role}` : ""] }, t.id))] })] }), e("div", { className: "ass\
ignment-form__actions", children: e("button", { type: "submit", disabled: Ee.kind === "loading", children: Ee.kind === "loading" ? "Saving\u2026" : "Save owner" }) }),
  Ee.kind !== "idle" ? e("p", { className: `assignment-status assignment-status--${Ee.kind}`, role: Ee.kind === "error" ? "alert" : "status", children: Ee.message }) :
  null] }) : e("p", { className: "assignment-status", role: "status", children: s.route?.taskId ? "Assignment controls are available to PM/admin bearer tokens." :
  "Open a task route to manage assignment." })] })] });
}

export { TaskDetailRoute };
