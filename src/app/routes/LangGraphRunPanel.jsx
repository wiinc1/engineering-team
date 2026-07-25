import { jsx as e, jsxs as a } from "react/jsx-runtime";
import React from "react";
import { buildAuthHeaders, readBrowserSessionConfig, resolveApiBaseUrl } from "../session.browser";

async function requestJson(url, init) {
  const response = await window.fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "Graph operation failed.");
  return payload.data;
}
function useRunStatus(baseUrl, session, threadId) {
  const [state, setState] = React.useState({ kind: "loading", data: null, message: "Loading graph run status." });
  const load = React.useCallback(async () => {
    if (!threadId) return;
    setState((current) => ({ ...current, kind: "loading", message: "Loading graph run status." }));
    try {
      const data = await requestJson(`${baseUrl}/v1/langgraph/runs/${encodeURIComponent(threadId)}`, {
        credentials: "same-origin", headers: buildAuthHeaders(session),
      });
      setState({ kind: "ready", data, message: "Graph run status loaded." });
    } catch (error) {
      setState({ kind: "error", data: null, message: error?.message || "Graph run status is unavailable." });
    }
  }, [baseUrl, threadId, session]);
  React.useEffect(() => { load(); }, [load]);
  return { load, setState, state };
}
function useRunActions(baseUrl, session, threadId, controller) {
  const [edits, setEdits] = React.useState("");
  const [reason, setReason] = React.useState("");
  const decide = React.useCallback(async (action) => {
    const interrupt = controller.state.data?.interrupt;
    if (!interrupt) return;
    controller.setState((current) => ({ ...current, kind: "loading", message: `Submitting ${action} decision.` }));
    try {
      await requestJson(`${baseUrl}/v1/langgraph/runs/${encodeURIComponent(threadId)}/interrupts/${encodeURIComponent(interrupt.interruptId)}/decision`, {
        method: "POST", credentials: "same-origin",
        headers: { ...buildAuthHeaders(session), "content-type": "application/json", "idempotency-key": `decision:${interrupt.interruptId}:${interrupt.decisionVersion}:${action}`, "if-match": String(interrupt.decisionVersion) },
        body: JSON.stringify({ action, checkpointId: interrupt.checkpointId, ...(action === "edit" ? { edits: { operator_note: edits.trim() } } : {}) }),
      });
      setEdits(""); await controller.load();
    } catch (error) { controller.setState((current) => ({ ...current, kind: "error", message: error?.message || "Graph decision failed." })); }
  }, [baseUrl, controller, edits, session, threadId]);
  const runAction = React.useCallback(async (action) => {
    if (!reason.trim()) return controller.setState((current) => ({ ...current, kind: "error", message: "A recovery reason is required." }));
    const data = controller.state.data;
    controller.setState((current) => ({ ...current, kind: "loading", message: `${action} is in progress.` }));
    try {
      await requestJson(`${baseUrl}/v1/langgraph/runs/${encodeURIComponent(threadId)}/${action}`, {
        method: "POST", credentials: "same-origin",
        headers: { ...buildAuthHeaders(session), "content-type": "application/json", "idempotency-key": `${action}:${threadId}:${data?.checkpoint?.id}:${Date.now()}` },
        body: JSON.stringify({ reason: reason.trim(), ...(action === "retry" ? { node: data.currentNode } : {}) }),
      });
      setReason(""); await controller.load();
    } catch (error) { controller.setState((current) => ({ ...current, kind: "error", message: error?.message || `Graph ${action} failed.` })); }
  }, [baseUrl, controller, reason, session, threadId]);
  return { decide, edits, reason, runAction, setEdits, setReason };
}
function InterruptControls({ interrupt, busy, actions }) {
  if (!interrupt) return null;
  return a("div", { className: "review-question-note", children: [
    e("span", { children: interrupt.type.replace(/_/g, " ") }, "type"), e("p", { children: interrupt.waitReason }, "reason"),
    e("p", { className: "task-list-meta", children: interrupt.nextAction }, "next"),
    a("label", { children: ["Edit note", e("textarea", { value: actions.edits, maxLength: 1000, onChange: (event) => actions.setEdits(event.target.value) }, "input")] }, "edit"),
    e("div", { className: "assignment-form__actions", children: [
      e("button", { type: "button", disabled: busy, onClick: () => actions.decide("accept"), children: "Accept" }, "accept"),
      e("button", { type: "button", className: "button-secondary", disabled: busy, onClick: () => actions.decide("reject"), children: "Reject" }, "reject"),
      e("button", { type: "button", className: "button-secondary", disabled: busy || !actions.edits.trim(), onClick: () => actions.decide("edit"), children: "Submit edit" }, "edit"),
    ] }, "actions"),
  ] });
}
function RunDetails({ data, busy, actions }) {
  return a("div", { children: [
    a("div", { className: "summary-grid", children: [
      a("article", { children: [e("span", { children: "Run state" }, "label"), e("strong", { children: data.lifecycleStatus || data.status }, "value")] }, "state"),
      a("article", { children: [e("span", { children: "Current node" }, "label"), e("strong", { children: data.currentNode || "Not started" }, "value")] }, "node"),
      a("article", { children: [e("span", { children: "Checkpoint" }, "label"), e("strong", { children: data.checkpoint?.stale ? "Stale" : "Fresh" }, "value")] }, "checkpoint"),
      a("article", { children: [e("span", { children: "Completed work" }, "label"), e("strong", { children: String(data.completedNodes?.length || 0) }, "value")] }, "completed"),
    ] }),
    e("p", { children: data.nextAction || "No graph action is currently required." }, "next-action"),
    e(InterruptControls, { interrupt: data.interrupt, busy, actions }, "interrupt"),
    a("label", { children: ["Recovery reason", e("textarea", { value: actions.reason, maxLength: 500, onChange: (event) => actions.setReason(event.target.value) }, "input")] }, "recovery-reason"),
    e("div", { className: "assignment-form__actions", children: [
      e("button", { type: "button", className: "button-secondary", disabled: busy || !data.error, onClick: () => actions.runAction("retry"), children: "Retry node" }, "retry"),
      e("button", { type: "button", className: "button-secondary", disabled: busy || ["completed", "cancelled"].includes(data.lifecycleStatus), onClick: () => actions.runAction("cancel"), children: "Cancel run" }, "cancel"),
    ] }, "recovery-actions"),
  ] });
}
function LangGraphRunPanel({ runRef, ctx = {} }) {
  const session = ctx.u || readBrowserSessionConfig();
  const baseUrl = ctx.D || resolveApiBaseUrl(session, ctx.At || "");
  const controller = useRunStatus(baseUrl, session, runRef?.threadId);
  const actions = useRunActions(baseUrl, session, runRef?.threadId, controller);
  if (!runRef?.threadId) return null;
  return a("section", { className: "detail-card detail-card--full", "aria-label": "Durable graph run", children: [
    e("h2", { children: "Durable graph run" }, "title"),
    e("p", { role: controller.state.kind === "error" ? "alert" : "status", "aria-live": "polite", children: controller.state.message }, "status"),
    controller.state.data ? e(RunDetails, { data: controller.state.data, busy: controller.state.kind === "loading", actions }, "details") : null,
  ] });
}

export { LangGraphRunPanel };
