import React from "react";

const SUPPORTED_ROLES = ["architect", "engineer", "qa", "sre"];

function authHeaders(session = {}) {
  return session.bearerToken ? { authorization: `Bearer ${session.bearerToken}` } : {};
}

async function parseApiResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || "AI-agent request failed.");
  }
  return body;
}

function csvList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
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
      routeKeywords: csvList(form.routeKeywords),
      taskTypes: csvList(form.taskTypes),
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

function ShellNav({ ctx }) {
  const { appNavClass, appNavToggle, collapsedNavRail, h, l, Ma, navOpen, sidebarTaskSearch } = ctx;
  return (
    <>
      {appNavToggle}
      {collapsedNavRail}
      <nav id="primary-navigation" className={appNavClass} aria-label="Primary navigation" aria-hidden={!navOpen} inert={navOpen ? undefined : true}>
        <div className="app-nav__links">
          {sidebarTaskSearch}
          <div className="app-nav__primary" role="group" aria-label="Primary task navigation">
            <button type="button" className="button-secondary" onClick={() => l("/tasks")}>Task workspace</button>
          </div>
          <div className="app-nav__secondary" role="group" aria-label="Secondary workspace navigation">
            <button type="button" className="button-secondary" onClick={() => l("/admin/users")}>User admin</button>
            <button type="button" onClick={() => l("/admin/ai-agents")}>AI agents</button>
          </div>
        </div>
        <div className="app-nav__session">
          <span>{h?.sub || "unknown actor"} · {h?.tenant_id || "unknown tenant"}</span>
          <button type="button" className="button-secondary" onClick={Ma}>Sign out</button>
        </div>
      </nav>
    </>
  );
}

function PageHeader() {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">AI-agent administration</p>
        <h1>AI Agent Activation</h1>
        <p className="lede">Preview delegated agent routing, dry-run proof, and live-surface impact before activation.</p>
      </div>
    </header>
  );
}

function AgentSetupForm({ form, setForm, runPreview, loading }) {
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form className="session-form auth-form" onSubmit={runPreview}>
      <h2 id="ai-agent-preview-form-title">Delegated agent setup</h2>
      <label>Agent ID<input value={form.agentId} onChange={update("agentId")} autoComplete="off" /></label>
      <label>Display name<input value={form.displayName} onChange={update("displayName")} autoComplete="off" /></label>
      <label>Role<RoleSelect value={form.role} onChange={update("role")} /></label>
      <label>Specialist<RoleSelect value={form.specialist} onChange={update("specialist")} /></label>
      <label>Runtime agent<input value={form.runtimeAgent} onChange={update("runtimeAgent")} autoComplete="off" /></label>
      <label>Route keywords<input value={form.routeKeywords} onChange={update("routeKeywords")} placeholder="comma-separated" autoComplete="off" /></label>
      <label>Task types<input value={form.taskTypes} onChange={update("taskTypes")} placeholder="comma-separated" autoComplete="off" /></label>
      <label>Sample task type<input value={form.sampleTaskType} onChange={update("sampleTaskType")} autoComplete="off" /></label>
      <label>Sample request<textarea value={form.sampleRequest} onChange={update("sampleRequest")} rows={3} /></label>
      <button type="submit" disabled={loading}>Preview activation</button>
    </form>
  );
}

function RoleSelect({ value, onChange }) {
  return (
    <select value={value} onChange={onChange}>
      {SUPPORTED_ROLES.map((role) => <option value={role} key={role}>{role.toUpperCase()}</option>)}
    </select>
  );
}

function PreviewMetadata({ preview }) {
  if (!preview) return null;
  return (
    <dl className="metadata-grid">
      <dt>Assignment controls</dt><dd>{preview.assignmentControlImpact?.visibleForNewAssignment ? "Visible for new assignment" : "Hidden or blocked"}</dd>
      <dt>Role inbox</dt><dd>{preview.roleInboxImpact?.routedRole || "None"}</dd>
      <dt>PM bucket</dt><dd>{preview.pmOverviewBucketImpact?.bucket || "None"}</dd>
      <dt>Dry-run</dt><dd>{preview.delegationImpact?.dryRun?.pass ? "Passed" : "Failed"}</dd>
      <dt>Fallback</dt><dd>{preview.fallbackBehavior?.coordinatorFallbackAllowedOnActivationFailure ? "Coordinator fallback allowed" : "Fail closed"}</dd>
    </dl>
  );
}

function PreviewBlockers({ preview }) {
  if (!preview) return null;
  if (!preview.blockers?.length) {
    return <p className="auth-status auth-status--notice">{previewSummary(preview)}</p>;
  }
  return (
    <div role="alert" className="auth-status auth-status--error">
      <p>{previewSummary(preview)}</p>
      <ul>{preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message || blocker.code}</li>)}</ul>
    </div>
  );
}

function PreviewSummary({ preview, status, saveDisabledReason, confirmed, setConfirmed, canSave, saveAgent, summaryRef }) {
  return (
    <section className="detail-panel ai-agent-preview-summary" aria-labelledby="ai-agent-preview-summary-title" tabIndex={-1} ref={summaryRef}>
      <h2 id="ai-agent-preview-summary-title">Preview result</h2>
      <p role="status" aria-live="polite">{status.message}</p>
      <p id="ai-agent-save-disabled-reason">{saveDisabledReason || "Live save is enabled for the confirmed passing preview."}</p>
      <PreviewMetadata preview={preview} />
      <PreviewBlockers preview={preview} />
      <form className="session-form__actions" onSubmit={saveAgent}>
        <label className="checkbox-label">
          <input type="checkbox" checked={confirmed} disabled={!preview || !!preview.blockers?.length} onChange={(event) => setConfirmed(event.target.checked)} />
          Confirm passing preview
        </label>
        <button type="submit" disabled={!canSave} aria-describedby="ai-agent-save-disabled-reason">Save live agent</button>
      </form>
    </section>
  );
}

function AdminPreviewSection(props) {
  if (!props.isAdmin) {
    return (
      <section className="empty-state" role="alert">
        <h2>Access denied</h2>
        <p>Admin role is required to preview AI-agent activation.</p>
      </section>
    );
  }
  return (
    <section className="detail-panel ai-agent-preview-admin" aria-labelledby="ai-agent-preview-form-title">
      <AgentSetupForm {...props} />
      <PreviewSummary {...props} />
    </section>
  );
}

function RoleRequestSection({ roleRequest, setRoleRequest, roleRequestStatus, submitRoleRequest }) {
  const update = (key) => (event) => setRoleRequest((current) => ({ ...current, [key]: event.target.value }));
  return (
    <section className="detail-panel" aria-labelledby="agent-role-request-title">
      <form className="session-form auth-form" onSubmit={submitRoleRequest}>
        <h2 id="agent-role-request-title">Unsupported role request</h2>
        <label>Requested role<input value={roleRequest.requestedRole} onChange={update("requestedRole")} autoComplete="off" /></label>
        <label>Request display name<input value={roleRequest.displayName} onChange={update("displayName")} autoComplete="off" /></label>
        <label>Justification<textarea value={roleRequest.justification} onChange={update("justification")} rows={3} /></label>
        <p role="status" aria-live="polite">{roleRequestStatus.message}</p>
        <button type="submit" disabled={roleRequestStatus.kind === "loading"}>Request unsupported role</button>
      </form>
    </section>
  );
}

function AiAgentsAdminRoute({ ctx }) {
  const { appShellClass, D, h, I, u } = ctx;
  const isAdmin = I(h, ["admin"]);
  const [form, setForm] = React.useState(DEFAULT_AGENT_FORM);
  const [preview, setPreview] = React.useState(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [status, setStatus] = React.useState({ kind: "idle", message: "Run preview before saving." });
  const [roleRequest, setRoleRequest] = React.useState(DEFAULT_ROLE_REQUEST);
  const [roleRequestStatus, setRoleRequestStatus] = React.useState({ kind: "idle", message: "Unsupported-role requests stay out of live routing." });
  const summaryRef = React.useRef(null);
  const baseUrl = String(D || "").replace(/\/+$/, "");

  React.useEffect(() => resetPreview(setPreview, setConfirmed, setStatus), [JSON.stringify(form)]);
  React.useEffect(() => { if (preview && summaryRef.current) summaryRef.current.focus(); }, [preview]);

  const saveDisabledReason = disabledReason(preview, confirmed);
  const canSave = !!preview && !preview.blockers?.length && confirmed && status.kind !== "loading";
  const actions = routeActions({ baseUrl, form, preview, roleRequest, u, setPreview, setConfirmed, setStatus, setRoleRequestStatus });

  return (
    <main className={appShellClass}>
      <ShellNav ctx={ctx} />
      <PageHeader />
      <AdminPreviewSection {...actions} form={form} setForm={setForm} preview={preview} status={status} confirmed={confirmed} setConfirmed={setConfirmed} saveDisabledReason={saveDisabledReason} canSave={canSave} isAdmin={isAdmin} summaryRef={summaryRef} loading={status.kind === "loading"} />
      <RoleRequestSection roleRequest={roleRequest} setRoleRequest={setRoleRequest} roleRequestStatus={roleRequestStatus} submitRoleRequest={actions.submitRoleRequest} />
    </main>
  );
}

const DEFAULT_AGENT_FORM = {
  agentId: "qa-preview-live",
  displayName: "QA Preview Live",
  role: "qa",
  specialist: "qa",
  runtimeAgent: "qa-engineer",
  routeKeywords: "",
  taskTypes: "",
  sampleTaskType: "",
  sampleRequest: "qa regression verification dry run",
};

const DEFAULT_ROLE_REQUEST = {
  requestedRole: "designer",
  displayName: "Design Specialist",
  justification: "Request a draft-only unsupported role for operator triage.",
};

function disabledReason(preview, confirmed) {
  if (!preview) return "Save is disabled until preview runs.";
  if (preview.blockers?.length) return "Save is disabled because preview blockers must be resolved.";
  if (!confirmed) return "Save is disabled until the passing preview is confirmed.";
  return "";
}

function resetPreview(setPreview, setConfirmed, setStatus) {
  setPreview(null);
  setConfirmed(false);
  setStatus({ kind: "idle", message: "Run preview before saving." });
}

function routeActions(context) {
  return {
    runPreview: (event) => runPreview(event, context),
    saveAgent: (event) => saveAgent(event, context),
    submitRoleRequest: (event) => submitRoleRequest(event, context),
  };
}

async function runPreview(event, context) {
  event.preventDefault();
  context.setStatus({ kind: "loading", message: "Running AI-agent activation preview." });
  context.setConfirmed(false);
  try {
    const body = await requestJson(context, "/v1/ai-agents/preview", buildAgentPayload(context.form));
    context.setPreview(body.data);
    context.setStatus(body.data?.blockers?.length
      ? { kind: "error", message: "Preview failed. Live save remains disabled." }
      : { kind: "success", message: "Preview passed. Confirm before live save." });
  } catch (error) {
    context.setPreview(null);
    context.setStatus({ kind: "error", message: error?.message || "Preview failed." });
  }
}

async function saveAgent(event, context) {
  event.preventDefault();
  context.setStatus({ kind: "loading", message: "Saving live delegated AI agent." });
  try {
    await requestJson(context, "/v1/ai-agents", {
      ...buildAgentPayload(context.form),
      previewConfirmation: { approved: true, token: context.preview.previewToken },
    });
    context.setStatus({ kind: "success", message: "Delegated AI agent saved live." });
  } catch (error) {
    context.setStatus({ kind: "error", message: error?.message || "Save failed." });
  }
}

async function submitRoleRequest(event, context) {
  event.preventDefault();
  context.setRoleRequestStatus({ kind: "loading", message: "Recording unsupported-role request." });
  try {
    const body = await requestJson(context, "/v1/agent-role-requests", context.roleRequest);
    context.setRoleRequestStatus({ kind: "success", message: `${body.data?.displayName || context.roleRequest.displayName} recorded as ${body.data?.status || "requested"} and not live-routed.` });
  } catch (error) {
    context.setRoleRequestStatus({ kind: "error", message: error?.message || "Role request failed." });
  }
}

async function requestJson({ baseUrl, u }, path, payload) {
  return parseApiResponse(await window.fetch(`${baseUrl}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { ...authHeaders(u), "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export {
  AiAgentsAdminRoute,
};
