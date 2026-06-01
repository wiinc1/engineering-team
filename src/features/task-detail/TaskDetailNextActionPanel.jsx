import React, { useEffect, useMemo, useState } from 'react';
import {
  isTaskDetailNextActionRedesignEnabled,
  resolveTaskDetailNextAction,
  taskDetailNextActionMetric,
} from './next-action.mjs';

function emitNextActionMetric(type, action) {
  if (typeof window === 'undefined' || !action) return;
  const metric = taskDetailNextActionMetric(action);
  window.dispatchEvent(new CustomEvent(`engineering-team:task-detail-next-action-${type}`, { detail: metric }));
}

function readCookie(name) {
  const prefix = `${name}=`;
  return String(typeof document === 'undefined' ? '' : document.cookie || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

function readBrowserSession() {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    return JSON.parse(sessionStorage.getItem('engineering-team.task-browser-session') || '{}');
  } catch {
    return {};
  }
}

async function retryPmRefinement(taskId) {
  const session = readBrowserSession();
  const base = String(session.apiBaseUrl || '/api').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json' };
  if (session.bearerToken) headers.authorization = `Bearer ${session.bearerToken}`;
  else {
    const csrf = decodeURIComponent(readCookie('engineering_team_csrf') || '');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const response = await fetch(`${base}/v1/tasks/${encodeURIComponent(taskId)}/refinement/start`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ trigger: 'task_detail_retry_button' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'PM refinement retry failed.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (payload?.success === false || payload?.data?.status === 'failed') {
    const reason = payload?.data?.fallbackReason || payload?.data?.userFacingReasonCategory || 'runtime unavailable';
    const error = new Error(`PM refinement retry failed: ${reason}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function RetryPmRefinementButton({ action, taskId, onActionComplete }) {
  const [status, setStatus] = useState({ kind: 'idle', message: '' });
  const loading = status.kind === 'loading';

  async function handleClick() {
    if (!taskId) return;
    emitNextActionMetric('click', action);
    setStatus({ kind: 'loading', message: 'Starting PM refinement...' });
    try {
      const result = await retryPmRefinement(taskId);
      const retryStatus = result?.data?.status || result?.status || 'started';
      setStatus({ kind: 'success', message: `PM refinement ${retryStatus}. Refreshing task detail...` });
      if (typeof onActionComplete === 'function') await onActionComplete(result);
    } catch (error) {
      setStatus({ kind: 'error', message: error?.message || 'PM refinement retry failed.' });
    }
  }

  return (
    <div className="task-next-action__primary-stack">
      <button className="task-next-action__primary" type="button" disabled={loading || !taskId} onClick={handleClick}>
        {loading ? 'Retrying...' : action.primaryLabel}
      </button>
      {status.kind !== 'idle' ? (
        <p className={`task-next-action__status task-next-action__status--${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

function ActionLink({ action, taskId, onActionComplete }) {
  if (!action.controlsAvailable || (!action.primaryHref && action.primaryAction !== 'retry_pm_refinement') || !action.primaryLabel) {
    return (
      <p className="task-next-action__permission" role="status">
        Action controls are unavailable for this session.
      </p>
    );
  }

  if (action.primaryAction === 'retry_pm_refinement') {
    return <RetryPmRefinementButton action={action} taskId={taskId} onActionComplete={onActionComplete} />;
  }

  return (
    <a
      className="task-next-action__primary"
      href={action.primaryHref}
      onClick={() => emitNextActionMetric('click', action)}
    >
      {action.primaryLabel}
    </a>
  );
}

function EvidenceList({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="task-next-action__evidence">
      <span>Evidence needed</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function StatusFacts({ facts = [] }) {
  return (
    <dl className="task-next-action__facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>
            {fact.value || 'Unknown'}
            {fact.detail ? <small>{fact.detail}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SecondaryLinks({ links = [] }) {
  if (!links.length) return null;
  return (
    <nav className="task-next-action__links" aria-label="Task detail section shortcuts">
      {links.map((link) => (
        <a key={`${link.href}-${link.label}`} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function TaskDetailNextActionPanel({ screen, principal, runtimeConfig, onActionComplete }) {
  const enabled = isTaskDetailNextActionRedesignEnabled(runtimeConfig);
  const action = useMemo(() => resolveTaskDetailNextAction(screen, principal), [screen, principal]);
  const taskId = screen?.detail?.task?.id || screen?.summary?.taskId || screen?.summary?.task_id || screen?.route?.taskId || null;

  useEffect(() => {
    if (enabled) emitNextActionMetric('impression', action);
  }, [action, enabled]);

  if (!enabled) return null;

  return (
    <section
      className={`task-next-action task-next-action--${action.tone}`}
      aria-labelledby="task-next-action-title"
      data-next-action={action.action}
      data-next-action-role={action.role}
    >
      <div className="task-next-action__main">
        <p className="eyebrow">{action.roleLabel} next action</p>
        <h2 id="task-next-action-title">{action.title}</h2>
        <p>{action.reason}</p>
        <ActionLink action={action} taskId={taskId} onActionComplete={onActionComplete} />
      </div>
      <div className="task-next-action__support">
        <StatusFacts facts={action.statusFacts} />
        <EvidenceList items={action.evidence} />
        <SecondaryLinks links={action.secondaryLinks} />
      </div>
    </section>
  );
}

export default TaskDetailNextActionPanel;
