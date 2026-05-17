import React from "react";
import { compareLiveUpdateVersions, permissionSafeMerge, reconcileLiveUpdates } from "./live-task-reconciler";
import { buildAuthHeaders, resolveApiBaseUrl } from "./session.browser";

const LOCAL_FLAG_KEY = "engineering-team.live-task-freshness-polling";
const LOCAL_POLL_MS_KEY = "engineering-team.live-task-freshness-poll-ms";
const STORAGE_KEY = "engineering-team.live-task-updates";
const CHANNEL_NAME = "engineering-team-live-task-updates";

function disabled(value) {
  return ["0", "false", "off", "disabled", "no"].includes(String(value || "").trim().toLowerCase());
}

function enabled(value) {
  return ["1", "true", "on", "enabled", "yes"].includes(String(value || "").trim().toLowerCase());
}

function readLocalFlag() {
  try {
    return window.localStorage.getItem(LOCAL_FLAG_KEY);
  } catch {
    return null;
  }
}

export function isLiveTaskFreshnessPollingEnabled(env = import.meta.env) {
  const local = typeof window !== "undefined" ? readLocalFlag() : null;
  if (enabled(local)) return true;
  if (disabled(local)) return false;
  const configured = env?.VITE_FF_LIVE_TASK_FRESHNESS_POLLING ?? env?.VITE_FF_TASK_FRESHNESS_POLLING;
  return enabled(configured);
}

function relevantUpdate(update, scope = {}) {
  if (!update) return false;
  if (scope.kind === "detail") return update.entityType === "task" && update.entityId === scope.taskId;
  if (scope.kind === "projects") {
    return update.entityType === "project" || update.payload?.task?.project_id === scope.projectId;
  }
  return update.entityType === "task" || update.entityType === "project";
}

function statusLabel(status) {
  switch (status) {
    case "fresh":
      return "Fresh";
    case "stale":
      return "Stale";
    case "reconnecting":
      return "Reconnecting";
    case "degraded":
      return "Degraded";
    case "polling":
      return "Polling";
    default:
      return "Manual refresh";
  }
}

export function LiveTaskFreshnessIndicator({ state, onManualRefresh, showDisabled = false }) {
  const status = state?.status || "disabled";
  if (status === "disabled" && !showDisabled) return null;
  const message = state?.message || (status === "disabled" ? "Live freshness disabled." : statusLabel(status));
  return React.createElement(
    "div",
    { className: `live-freshness live-freshness--${status}`, role: "status", "aria-live": "polite" },
    React.createElement("span", null, statusLabel(status)),
    React.createElement("span", null, message),
    onManualRefresh
      ? React.createElement("button", { type: "button", className: "button-secondary", onClick: onManualRefresh }, "Refresh now")
      : null,
  );
}

function publishUpdates(payload) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, receivedAt: Date.now() }));
  } catch {}
}

function openBroadcastChannel(onMessage) {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = event => onMessage(event.data);
  return channel;
}

function readPollMsOverride(defaultMs) {
  if (typeof window === "undefined") return defaultMs;
  try {
    const configured = Number(window.localStorage.getItem(LOCAL_POLL_MS_KEY));
    return Number.isFinite(configured) && configured >= 100 ? configured : defaultMs;
  } catch {
    return defaultMs;
  }
}

function initialPollingState(liveEnabled) {
  return {
    status: liveEnabled ? "polling" : "disabled",
    message: liveEnabled ? "Polling for live task updates." : "Manual refresh remains available.",
  };
}

function useLiveScopeRef(scope) {
  const scopeRef = React.useRef(scope || {});
  const scopeKey = JSON.stringify(scope || {});
  React.useEffect(() => {
    scopeRef.current = scope || {};
  }, [scopeKey]);
  return scopeRef;
}

function useLiveUpdateApplier(scopeRef, onUpdates) {
  const versionsRef = React.useRef({});
  const primedRef = React.useRef(false);
  const applyUpdates = React.useCallback((updates = []) => {
    const relevant = updates.filter(update => relevantUpdate(update, scopeRef.current));
    const next = reconcileLiveUpdates({ versions: versionsRef.current }, relevant);
    versionsRef.current = next.versions;
    if (primedRef.current && next.accepted.length && typeof onUpdates === "function") onUpdates(next.accepted);
    return next.accepted.length;
  }, [onUpdates, scopeRef]);
  return { applyUpdates, primedRef };
}

async function fetchLiveUpdates(context) {
  const query = context.cursorRef.current ? `?cursor=${encodeURIComponent(context.cursorRef.current)}` : "";
  const response = await fetch(`${context.baseUrl}/v1/tasks/updates${query}`, {
    credentials: "same-origin",
    headers: buildAuthHeaders(context.session || {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Live update polling failed.");
  return payload;
}

function handlePollSuccess(context, payload) {
  context.cursorRef.current = payload?.data?.cursor || context.cursorRef.current;
  const acceptedCount = context.applyUpdates(payload?.data?.updates || []);
  context.primedRef.current = true;
  context.failures = 0;
  context.lastSuccessAt = Date.now();
  context.setState({ status: "fresh", message: acceptedCount ? "Fresh updates applied." : "No new updates." });
  publishUpdates(payload.data || {});
  context.channel?.postMessage(payload.data || {});
}

function handlePollFailure(context, error) {
  context.failures += 1;
  const stale = Date.now() - context.lastSuccessAt > context.staleAfterMs;
  context.setState({
    status: context.failures >= 3 ? "degraded" : stale ? "stale" : "reconnecting",
    message: error?.message || "Polling retry is in progress.",
  });
}

async function pollLiveUpdates(context) {
  try {
    handlePollSuccess(context, await fetchLiveUpdates(context));
  } catch (error) {
    handlePollFailure(context, error);
  } finally {
    if (!context.cancelled) context.timer = window.setTimeout(context.poll, context.effectivePollMs);
  }
}

function startLivePolling(options) {
  if (!options.liveEnabled) {
    options.setState({ status: "disabled", message: "Manual refresh remains available." });
    return undefined;
  }
  const context = {
    ...options,
    baseUrl: resolveApiBaseUrl(options.session || {}, options.defaultBaseUrl),
    cancelled: false,
    channel: openBroadcastChannel(payload => payload?.updates && options.applyUpdates(payload.updates)),
    effectivePollMs: readPollMsOverride(options.pollMs),
    failures: 0,
    lastSuccessAt: Date.now(),
    timer: null,
  };
  context.poll = () => pollLiveUpdates(context);
  context.poll();
  return () => {
    context.cancelled = true;
    if (context.timer) window.clearTimeout(context.timer);
    context.channel?.close();
  };
}

export function useLiveTaskFreshnessPolling({
  session,
  defaultBaseUrl = "",
  scope,
  onUpdates,
  enabled: enabledOverride,
  pollMs = 8000,
  staleAfterMs = 15000,
} = {}) {
  const liveEnabled = enabledOverride ?? isLiveTaskFreshnessPollingEnabled();
  const [state, setState] = React.useState(() => initialPollingState(liveEnabled));
  const cursorRef = React.useRef("");
  const scopeRef = useLiveScopeRef(scope);
  const { applyUpdates, primedRef } = useLiveUpdateApplier(scopeRef, onUpdates);

  React.useEffect(() => startLivePolling({
    applyUpdates, cursorRef, defaultBaseUrl, liveEnabled, pollMs, primedRef, session, setState, staleAfterMs,
  }), [applyUpdates, defaultBaseUrl, liveEnabled, pollMs, primedRef, session, staleAfterMs]);

  return state;
}

export {
  compareLiveUpdateVersions,
  LOCAL_FLAG_KEY,
  LOCAL_POLL_MS_KEY,
  permissionSafeMerge,
  reconcileLiveUpdates,
  STORAGE_KEY,
};
