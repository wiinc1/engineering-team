import { jsx as e, jsxs as a } from "react/jsx-runtime";
import c from "react";

function authHeaders(session = {}) {
  const headers = {};
  if (session.bearerToken) headers.authorization = `Bearer ${session.bearerToken}`;
  return headers;
}

async function parseApiResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || "AI-agent request failed.");
  }
  return body;
}

function buildAgentPayload(form) {
  return {
    agentId: form.agentId.trim(),
    displayName: form.displayName.trim(),
    role: form.role,
    active: true,
    delegation: {
      enabled: true,
      specialist: form.specialist,
      runtimeAgent: form.runtimeAgent.trim(),
      routeKeywords: form.routeKeywords.split(",").map((item) => item.trim()).filter(Boolean),
      taskTypes: form.taskTypes.split(",").map((item) => item.trim()).filter(Boolean),
      sampleTaskType: form.sampleTaskType.trim() || null,
      sampleRequest: form.sampleRequest.trim(),
    },
  };
}

function previewSummary(preview) {
  if (!preview) return "Run preview before saving.";
  const blockers = preview.blockers || [];
  if (blockers.length) return `Preview blocked by ${blockers.length} issue${blockers.length === 1 ? "" : "s"}.`;
  return "Preview passed. Confirm the preview to enable live save.";
}

function AiAgentsAdminRoute({ ctx }) {
  const { appNavClass, appNavToggle, appShellClass, collapsedNavRail, D, h, I, l, Ma, navOpen, sidebarTaskSearch, u } = ctx;
  const isAdmin = I(h, ["admin"]);
  const [form, setForm] = c.useState({
    agentId: "qa-preview-live",
    displayName: "QA Preview Live",
    role: "qa",
    specialist: "qa",
    runtimeAgent: "qa-engineer",
    routeKeywords: "",
    taskTypes: "",
    sampleTaskType: "",
    sampleRequest: "qa regression verification dry run",
  });
  const [preview, setPreview] = c.useState(null);
  const [confirmed, setConfirmed] = c.useState(false);
  const [status, setStatus] = c.useState({ kind: "idle", message: "Run preview before saving." });
  const [roleRequest, setRoleRequest] = c.useState({
    requestedRole: "designer",
    displayName: "Design Specialist",
    justification: "Request a draft-only unsupported role for operator triage.",
  });
  const [roleRequestStatus, setRoleRequestStatus] = c.useState({ kind: "idle", message: "Unsupported-role requests stay out of live routing." });
  const summaryRef = c.useRef(null);
  const previewKey = JSON.stringify(form);

  c.useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    setStatus({ kind: "idle", message: "Run preview before saving." });
  }, [previewKey]);

  c.useEffect(() => {
    if (preview && summaryRef.current) summaryRef.current.focus();
  }, [preview]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateRoleRequest = (key) => (event) => setRoleRequest((current) => ({ ...current, [key]: event.target.value }));
  const baseUrl = String(D || "").replace(/\/+$/, "");
  const saveDisabledReason = !preview
    ? "Save is disabled until preview runs."
    : preview.blockers?.length
      ? "Save is disabled because preview blockers must be resolved."
      : !confirmed
        ? "Save is disabled until the passing preview is confirmed."
        : "";
  const canSave = !!preview && !preview.blockers?.length && confirmed && status.kind !== "loading";

  async function runPreview(event) {
    event.preventDefault();
    setStatus({ kind: "loading", message: "Running AI-agent activation preview." });
    setConfirmed(false);
    try {
      const body = await parseApiResponse(await window.fetch(`${baseUrl}/v1/ai-agents/preview`, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...authHeaders(u), "content-type": "application/json" },
        body: JSON.stringify(buildAgentPayload(form)),
      }));
      setPreview(body.data);
      setStatus({
        kind: body.data?.blockers?.length ? "error" : "success",
        message: body.data?.blockers?.length ? "Preview failed. Live save remains disabled." : "Preview passed. Confirm before live save.",
      });
    } catch (error) {
      setPreview(null);
      setStatus({ kind: "error", message: error?.message || "Preview failed." });
    }
  }

  async function saveAgent(event) {
    event.preventDefault();
    if (!canSave) return;
    setStatus({ kind: "loading", message: "Saving live delegated AI agent." });
    try {
      await parseApiResponse(await window.fetch(`${baseUrl}/v1/ai-agents`, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...authHeaders(u), "content-type": "application/json" },
        body: JSON.stringify({
          ...buildAgentPayload(form),
          previewConfirmation: { approved: true, token: preview.previewToken },
        }),
      }));
      setStatus({ kind: "success", message: "Delegated AI agent saved live." });
    } catch (error) {
      setStatus({ kind: "error", message: error?.message || "Save failed." });
    }
  }

  async function submitRoleRequest(event) {
    event.preventDefault();
    setRoleRequestStatus({ kind: "loading", message: "Recording unsupported-role request." });
    try {
      const body = await parseApiResponse(await window.fetch(`${baseUrl}/v1/agent-role-requests`, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...authHeaders(u), "content-type": "application/json" },
        body: JSON.stringify(roleRequest),
      }));
      setRoleRequestStatus({
        kind: "success",
        message: `${body.data?.displayName || roleRequest.displayName} recorded as ${body.data?.status || "requested"} and not live-routed.`,
      });
    } catch (error) {
      setRoleRequestStatus({ kind: "error", message: error?.message || "Role request failed." });
    }
  }

  return a("main", { className: appShellClass, children: [appNavToggle, collapsedNavRail, a("nav", { id: "primary-navigation", className: appNavClass, "aria-label": "Primary navigation", "aria-hidden": !navOpen, inert: navOpen ? void 0 : true, children: [a("div", { className: "app-nav__links", children: [sidebarTaskSearch, a("div", { className: "app-nav__primary", role: "group", "aria-label": "Primary task navigation", children: [e("button", { type: "button", className: "button-secondary", onClick: () => l("/tasks"), children: "Task workspace" })] }), a("div", { className: "app-nav__secondary", role: "group", "aria-label": "Secondary workspace navigation", children: [e("button", { type: "button", className: "button-secondary", onClick: () => l("/admin/users"), children: "User admin" }), e("button", { type: "button", onClick: () => l("/admin/ai-agents"), children: "AI agents" })] })] }), a("div", { className: "app-nav__session", children: [a("span", { children: [h?.sub || "unknown actor", " · ", h?.tenant_id || "unknown tenant"] }), e("button", { type: "button", className: "button-secondary", onClick: Ma, children: "Sign out" })] })] }), e("header", { className: "page-header", children: a("div", { children: [e("p", { className: "eyebrow", children: "AI-agent administration" }), e("h1", { children: "AI Agent Activation" }), e("p", { className: "lede", children: "Preview delegated agent routing, dry-run proof, and live-surface impact before activation." })] }) }), isAdmin ? a("section", { className: "detail-panel ai-agent-preview-admin", "aria-labelledby": "ai-agent-preview-form-title", children: [a("form", { className: "session-form auth-form", onSubmit: runPreview, children: [e("h2", { id: "ai-agent-preview-form-title", children: "Delegated agent setup" }), a("label", { children: ["Agent ID", e("input", { value: form.agentId, onChange: update("agentId"), autoComplete: "off" })] }), a("label", { children: ["Display name", e("input", { value: form.displayName, onChange: update("displayName"), autoComplete: "off" })] }), a("label", { children: ["Role", a("select", { value: form.role, onChange: update("role"), children: ["architect", "engineer", "qa", "sre"].map((role) => e("option", { value: role, children: role.toUpperCase() }, role)) })] }), a("label", { children: ["Specialist", a("select", { value: form.specialist, onChange: update("specialist"), children: ["architect", "engineer", "qa", "sre"].map((role) => e("option", { value: role, children: role.toUpperCase() }, role)) })] }), a("label", { children: ["Runtime agent", e("input", { value: form.runtimeAgent, onChange: update("runtimeAgent"), autoComplete: "off" })] }), a("label", { children: ["Route keywords", e("input", { value: form.routeKeywords, onChange: update("routeKeywords"), placeholder: "comma-separated", autoComplete: "off" })] }), a("label", { children: ["Task types", e("input", { value: form.taskTypes, onChange: update("taskTypes"), placeholder: "comma-separated", autoComplete: "off" })] }), a("label", { children: ["Sample task type", e("input", { value: form.sampleTaskType, onChange: update("sampleTaskType"), autoComplete: "off" })] }), a("label", { children: ["Sample request", e("textarea", { value: form.sampleRequest, onChange: update("sampleRequest"), rows: 3 })] }), e("button", { type: "submit", disabled: status.kind === "loading", children: "Preview activation" })] }), a("section", { className: "detail-panel ai-agent-preview-summary", "aria-labelledby": "ai-agent-preview-summary-title", tabIndex: -1, ref: summaryRef, children: [e("h2", { id: "ai-agent-preview-summary-title", children: "Preview result" }), e("p", { role: "status", "aria-live": "polite", children: status.message }), e("p", { id: "ai-agent-save-disabled-reason", children: saveDisabledReason || "Live save is enabled for the confirmed passing preview." }), preview ? a("dl", { className: "metadata-grid", children: [e("dt", { children: "Assignment controls" }), e("dd", { children: preview.assignmentControlImpact?.visibleForNewAssignment ? "Visible for new assignment" : "Hidden or blocked" }), e("dt", { children: "Role inbox" }), e("dd", { children: preview.roleInboxImpact?.routedRole || "None" }), e("dt", { children: "PM bucket" }), e("dd", { children: preview.pmOverviewBucketImpact?.bucket || "None" }), e("dt", { children: "Dry-run" }), e("dd", { children: preview.delegationImpact?.dryRun?.pass ? "Passed" : "Failed" }), e("dt", { children: "Fallback" }), e("dd", { children: preview.fallbackBehavior?.coordinatorFallbackAllowedOnActivationFailure ? "Coordinator fallback allowed" : "Fail closed" })] }) : null, preview?.blockers?.length ? a("div", { role: "alert", className: "auth-status auth-status--error", children: [e("p", { children: previewSummary(preview) }), a("ul", { children: preview.blockers.map((blocker) => e("li", { children: blocker.message || blocker.code }, blocker.code)) })] }) : preview ? e("p", { className: "auth-status auth-status--notice", children: previewSummary(preview) }) : null, a("form", { className: "session-form__actions", onSubmit: saveAgent, children: [a("label", { className: "checkbox-label", children: [e("input", { type: "checkbox", checked: confirmed, disabled: !preview || !!preview.blockers?.length, onChange: (event) => setConfirmed(event.target.checked) }), "Confirm passing preview"] }), e("button", { type: "submit", disabled: !canSave, "aria-describedby": "ai-agent-save-disabled-reason", children: "Save live agent" })] })] })] }) : a("section", { className: "empty-state", role: "alert", children: [e("h2", { children: "Access denied" }), e("p", { children: "Admin role is required to preview AI-agent activation." })] }), a("section", { className: "detail-panel", "aria-labelledby": "agent-role-request-title", children: [a("form", { className: "session-form auth-form", onSubmit: submitRoleRequest, children: [e("h2", { id: "agent-role-request-title", children: "Unsupported role request" }), a("label", { children: ["Requested role", e("input", { value: roleRequest.requestedRole, onChange: updateRoleRequest("requestedRole"), autoComplete: "off" })] }), a("label", { children: ["Request display name", e("input", { value: roleRequest.displayName, onChange: updateRoleRequest("displayName"), autoComplete: "off" })] }), a("label", { children: ["Justification", e("textarea", { value: roleRequest.justification, onChange: updateRoleRequest("justification"), rows: 3 })] }), e("p", { role: "status", "aria-live": "polite", children: roleRequestStatus.message }), e("button", { type: "submit", disabled: roleRequestStatus.kind === "loading", children: "Request unsupported role" })] })] })] });
}

export {
  AiAgentsAdminRoute
};
