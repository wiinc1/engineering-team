import React from "react";
import { LiveTaskFreshnessIndicator, useLiveTaskFreshnessPolling } from "../live-task-freshness";
import { buildAuthHeaders, resolveApiBaseUrl } from "../session.browser";

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

function projectIdFromPath(pathname = "") {
  const match = String(pathname || "").match(/^\/projects\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isProjectsPath(pathname = "") {
  return pathname === "/projects" || /^\/projects\/[^/]+$/.test(pathname);
}

function canWriteProjects(claims) {
  return (claims?.roles || []).some((role) => role === "pm" || role === "admin");
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed with status ${response.status}`);
  return payload.data ?? payload;
}

function createProjectsApi(ctx) {
  const baseUrl = resolveApiBaseUrl(ctx.u, ctx.At);
  const request = async (path, init = {}) => parseResponse(await fetch(`${baseUrl}${path}`, {
    credentials: "same-origin",
    method: init.method || "GET",
    headers: { ...buildAuthHeaders(ctx.u), ...(init.headers || {}) },
    body: init.body,
  }));
  return {
    list: () => request("/v1/projects"),
    get: (id) => request(`/v1/projects/${encodeURIComponent(id)}`),
    create: (payload) => request("/v1/projects", jsonInit("POST", payload)),
    update: (id, payload) => request(`/v1/projects/${encodeURIComponent(id)}`, jsonInit("PATCH", payload)),
    task: (id) => request(`/v1/tasks/${encodeURIComponent(id)}`),
    assignTask: (id, payload) => request(`/v1/tasks/${encodeURIComponent(id)}/project`, jsonInit("PATCH", payload)),
  };
}

function jsonInit(method, payload) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function useProjectRoute(ctx) {
  const api = React.useMemo(() => createProjectsApi(ctx), [ctx.At, ctx.u]);
  const projectId = projectIdFromPath(ctx.i);
  const [state, setState] = React.useState({ kind: "loading", projects: [], project: null, message: "" });
  const loadSequenceRef = React.useRef(0);
  const load = React.useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setState((current) => ({ ...current, kind: "loading", message: "" }));
    try {
      const data = projectId ? await api.get(projectId) : await api.list();
      if (sequence !== loadSequenceRef.current) return;
      setState(projectId ? { kind: "ready", projects: [], project: data, message: "" } : { kind: "ready", projects: data || [], project: null, message: "" });
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      setState({ kind: "error", projects: [], project: null, message: error?.message || "Project load failed." });
    }
  }, [api, projectId]);
  React.useEffect(() => {
    load();
  }, [load]);
  return { api, load, projectId, state };
}

function StatusMessage({ status }) {
  if (!status || status.kind === "idle") return null;
  return <p className={`assignment-status assignment-status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>{status.message}</p>;
}

function ProjectCreateForm({ canWrite, onCreate, status }) {
  const [form, setForm] = React.useState({ name: "", summary: "", status: "PLANNING", ownerActorId: "" });
  if (!canWrite) return <p className="task-list-meta">Reader access can inspect Projects but cannot create or modify planning containers.</p>;
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <form className="architect-handoff-form" onSubmit={(event) => {
    event.preventDefault();
    onCreate(form).then(() => setForm({ name: "", summary: "", status: "PLANNING", ownerActorId: "" }));
  }}>
    <label>Project name<input value={form.name} onChange={update("name")} required maxLength={120} /></label>
    <label>Summary<textarea value={form.summary} onChange={update("summary")} /></label>
    <label>Status<ProjectStatusSelect value={form.status} onChange={update("status")} /></label>
    <label>Owner actor<input value={form.ownerActorId} onChange={update("ownerActorId")} placeholder="pm, architect, or team actor" /></label>
    <div className="assignment-form__actions"><button type="submit" disabled={status.kind === "loading"}>{status.kind === "loading" ? "Creating..." : "Create project"}</button></div>
    <StatusMessage status={status} />
  </form>;
}

function ProjectStatusSelect({ value, onChange }) {
  return <select value={value} onChange={onChange}>{PROJECT_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select>;
}

function ProjectList({ projects, onOpen }) {
  if (!projects.length) return <div className="empty-state" role="status"><h2>No Projects yet</h2><p>Create a Project to group planned tasks without changing task lifecycle ownership.</p></div>;
  return <div className="task-list-table-wrap"><table className="task-list-table"><thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Tasks</th></tr></thead><tbody>{projects.map((project) => <tr key={project.projectId}>
    <td><a href={`/projects/${encodeURIComponent(project.projectId)}`} onClick={(event) => {
      event.preventDefault();
      onOpen(project.projectId);
    }}><strong>{project.name}</strong></a><div className="task-list-meta">{project.projectId}</div></td>
    <td><span className="routing-badge">{project.status}</span></td>
    <td>{project.ownerActorId || "Unassigned"}</td>
    <td>{project.taskCount}</td>
  </tr>)}</tbody></table></div>;
}

function ProjectEditForm({ canWrite, project, onUpdate, status }) {
  const [form, setForm] = React.useState(() => ({ name: project.name, summary: project.summary || "", status: project.status, ownerActorId: project.ownerActorId || "" }));
  React.useEffect(() => setForm({ name: project.name, summary: project.summary || "", status: project.status, ownerActorId: project.ownerActorId || "" }), [project]);
  if (!canWrite) return null;
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <form className="architect-handoff-form" onSubmit={(event) => {
    event.preventDefault();
    onUpdate({ ...form, version: project.version });
  }}>
    <label>Name<input value={form.name} onChange={update("name")} required maxLength={120} /></label>
    <label>Summary<textarea value={form.summary} onChange={update("summary")} /></label>
    <label>Status<ProjectStatusSelect value={form.status} onChange={update("status")} /></label>
    <label>Owner actor<input value={form.ownerActorId} onChange={update("ownerActorId")} /></label>
    <div className="assignment-form__actions"><button type="submit" disabled={status.kind === "loading"}>{status.kind === "loading" ? "Saving..." : "Save project"}</button></div>
    <StatusMessage status={status} />
  </form>;
}

function TaskAttachForm({ canWrite, onAttach, status }) {
  const [taskId, setTaskId] = React.useState("");
  if (!canWrite) return null;
  return <form className="assignment-form" onSubmit={(event) => {
    event.preventDefault();
    onAttach(taskId).then(() => setTaskId(""));
  }}>
    <label>Task ID<input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="TSK-..." required /></label>
    <div className="assignment-form__actions"><button type="submit" disabled={status.kind === "loading"}>{status.kind === "loading" ? "Attaching..." : "Attach task"}</button></div>
    <StatusMessage status={status} />
  </form>;
}

function ProjectTasks({ project, canWrite, onDetach }) {
  const tasks = project.tasks || [];
  if (!tasks.length) return <div className="empty-state" role="status"><h2>No tasks in this Project</h2><p>Attach existing task IDs to bring work into this planning container.</p></div>;
  return <div className="task-list-table-wrap"><table className="task-list-table"><thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Action</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.taskId || task.task_id}>
    <td><a href={`/tasks/${encodeURIComponent(task.taskId || task.task_id)}`}>{task.title || task.taskId || task.task_id}</a><div className="task-list-meta">{task.taskId || task.task_id}</div></td>
    <td>{task.status || task.current_stage || "Unknown"}</td>
    <td>{task.priority || "-"}</td>
    <td>{canWrite ? <button className="button-secondary" type="button" onClick={() => onDetach(task)}>Detach</button> : "Read-only"}</td>
  </tr>)}</tbody></table></div>;
}

function ProjectDetail({ project, canWrite, onBack, onUpdate, onAttach, onDetach, editStatus, attachStatus }) {
  return <section className="project-detail-view"><div className="role-inbox-toolbar"><div><p className="eyebrow">Planning container</p><h2>{project.name}</h2><p className="role-inbox-toolbar__cue">{project.summary || "No summary recorded."}</p></div><div className="task-list-toolbar__actions"><span className="routing-badge">{project.status}</span><button className="button-secondary" type="button" onClick={onBack}>All projects</button></div></div>
    <ProjectEditForm canWrite={canWrite} project={project} onUpdate={onUpdate} status={editStatus} />
    <TaskAttachForm canWrite={canWrite && project.status !== "ARCHIVED"} onAttach={onAttach} status={attachStatus} />
    <ProjectTasks project={project} canWrite={canWrite && project.status !== "ARCHIVED"} onDetach={onDetach} />
  </section>;
}

function ProjectsRoute({ ctx }) {
  const { api, load, projectId, state } = useProjectRoute(ctx);
  const liveFreshness = useLiveTaskFreshnessPolling({
    session: ctx.u,
    defaultBaseUrl: ctx.At,
    scope: { kind: "projects", projectId },
    onUpdates: load,
  });
  const [createStatus, setCreateStatus] = React.useState({ kind: "idle", message: "" });
  const [editStatus, setEditStatus] = React.useState({ kind: "idle", message: "" });
  const [attachStatus, setAttachStatus] = React.useState({ kind: "idle", message: "" });
  const writable = canWriteProjects(ctx.h);
  const create = async (payload) => runMutation(setCreateStatus, "Project created.", async () => {
    await api.create(payload);
    await load();
  });
  const update = async (payload) => runMutation(setEditStatus, "Project updated.", async () => {
    await api.update(projectId, payload);
    await load();
  });
  const attach = async (taskId) => runMutation(setAttachStatus, "Task attached.", async () => {
    const task = await api.task(taskId.trim());
    await api.assignTask(taskId.trim(), { projectId, version: task.version || task.data?.version });
    await load();
  });
  const detach = async (task) => runMutation(setAttachStatus, "Task detached.", async () => {
    await api.assignTask(task.taskId || task.task_id, { projectId: null, version: task.version });
    await load();
  });
  return <section className="task-list-panel" aria-label="Projects workspace">
    {state.kind === "loading" ? <p role="status">Loading Projects.</p> : null}
    {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
    <LiveTaskFreshnessIndicator state={liveFreshness} onManualRefresh={load} />
    {!projectId && state.kind === "ready" ? <><div className="role-inbox-toolbar"><div><p className="eyebrow">Planning containers</p><h2>Projects</h2><p className="role-inbox-toolbar__cue">Group tasks into PM-owned delivery plans while lifecycle, owner, and audit state remain on the task.</p></div><button type="button" onClick={load}>Refresh</button></div><ProjectCreateForm canWrite={writable} onCreate={create} status={createStatus} /><ProjectList projects={state.projects} onOpen={(id) => ctx.l(`/projects/${encodeURIComponent(id)}`)} /></> : null}
    {projectId && state.kind === "ready" && state.project ? <ProjectDetail project={state.project} canWrite={writable} onBack={() => ctx.l("/projects")} onUpdate={update} onAttach={attach} onDetach={detach} editStatus={editStatus} attachStatus={attachStatus} /> : null}
  </section>;
}

async function runMutation(setStatus, successMessage, action) {
  setStatus({ kind: "loading", message: successMessage });
  try {
    await action();
    setStatus({ kind: "success", message: successMessage });
  } catch (error) {
    setStatus({ kind: "error", message: error?.message || "Project action failed." });
  }
}

export {
  ProjectsRoute,
  isProjectsPath,
};
