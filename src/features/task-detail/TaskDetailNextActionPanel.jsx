import React, { useEffect, useMemo } from 'react';
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

function ActionLink({ action }) {
  if (!action.controlsAvailable || !action.primaryHref || !action.primaryLabel) {
    return (
      <p className="task-next-action__permission" role="status">
        Action controls are unavailable for this session.
      </p>
    );
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
          <dd>{fact.value || 'Unknown'}</dd>
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

export function TaskDetailNextActionPanel({ screen, principal, runtimeConfig }) {
  const enabled = isTaskDetailNextActionRedesignEnabled(runtimeConfig);
  const action = useMemo(() => resolveTaskDetailNextAction(screen, principal), [screen, principal]);

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
        <ActionLink action={action} />
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
