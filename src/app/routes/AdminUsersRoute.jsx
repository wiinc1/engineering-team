import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";

function AdminUsersRoute({ ctx }) {
  const {
    Aa, appNavClass, appNavToggle, appShellClass, at, AUTH_USER_STATUS_OPTIONS, ca, collapsedNavRail,
    fs, h, I, ke, l, Ma, mi, navOpen,
    Oa, pi, sidebarTaskSearch, Te, V, W, Za
  } = ctx;
  const t = I(h, ["admin"]);
  return a("main", { className: appShellClass, children: [appNavToggle, collapsedNavRail, a("nav", { id: "primary-navigation", className: appNavClass, "aria-l\
abel": "Primary navigation", "aria-hidden": !navOpen, inert: navOpen ? void 0 : true, children: [a("div", { className: "app-nav__links", children: [sidebarTaskSearch,
    a("div", { className: "app-nav__primary", role: "group", "aria-label": "Primary task navigation", children: [e("button", { type: "button", className: "butto\
n-secondary", onClick: () => l("/tasks"), children: "Task workspace" })] }), a("div", { className: "app-nav__secondary", role: "group", "aria-label": "Secondary\
 workspace navigation", children: [e("button", { type: "button", className: t ? "" : "button-secondary", onClick: () => l("/admin/users"), children: "User admin" })] })] }),
    a("div", { className: "app-nav__session", children: [a("span", { children: [h?.sub || "unknown actor", " \xB7 ", h?.tenant_id || "unknown tenant"] }), e("bu\
tton", { type: "button", className: "button-secondary", onClick: Ma, children: "Sign out" })] })] }), V ? e("p", { className: "auth-status auth-status--error", role: "\
alert", children: V }) : null, e("header", { className: "page-header", children: a("div", { children: [e("p", { className: "eyebrow", children: "Authentication \
administration" }), e("h1", { children: "User admin" }), e("p", { className: "lede", children: "Manage registered users and role assignments for credential sign\
-in." })] }) }), t ? a("section", { className: "detail-panel", children: [a("form", { className: "session-form auth-form", onSubmit: mi, children: [a("label", {
    children: ["Email", e("input", { value: W.email, onChange: (n) => at((r) => ({ ...r, email: n.target.value })), type: "email" })] }), a("label", { children: [
    "Tenant ID", e("input", { value: W.tenantId, onChange: (n) => at((r) => ({ ...r, tenantId: n.target.value })) })] }), a("label", { children: ["Actor ID", e(
    "input", { value: W.actorId, onChange: (n) => at((r) => ({ ...r, actorId: n.target.value })) })] }), a("label", { children: ["Roles", e("input", { value: W.
    roles, onChange: (n) => at((r) => ({ ...r, roles: n.target.value })), placeholder: "reader,pm,admin" })] }), a("label", { children: ["Status", a("select", {
    value: W.status, onChange: (n) => at((r) => ({ ...r, status: n.target.value })), children: AUTH_USER_STATUS_OPTIONS.map((n) => e("option", { value: n.value,
    children: n.label }, n.value)) })] }), a("div", { className: "session-form__actions", children: [e("button", { type: "submit", disabled: ke.kind === "loadin\
g", children: "Save user" }), e("button", { type: "button", className: "button-secondary", onClick: Te, children: "Refresh" })] })] }), ke.kind === "error" ? e(
    "p", { className: "auth-status auth-status--error", role: "alert", children: ke.message }) : null, ke.kind === "success" || ke.kind === "loading" ? e("p", {
    className: "auth-status auth-status--notice", role: "status", children: ke.message }) : null, e("div", { className: "table-wrap", children: a("table", { children: [
    e("thead", { children: a("tr", { children: [e("th", { children: "Email" }), e("th", { children: "Actor" }), e("th", { children: "Tenant" }), e("th", { children: "\
Roles" }), e("th", { children: "Status" }), e("th", { children: "Last sign-in" }), e("th", { children: "Actions" })] }) }), e("tbody", { children: fs.map((n) => {
      const r = Aa[n.userId] || Za(n), d = r.status === "disabled" ? "active" : r.status === "pending_approval" ? "active" : "disabled", statusActionLabel = r.status ===
      "disabled" ? "Reactivate" : r.status === "pending_approval" ? "Approve" : "Disable", statusActionMessage = r.status === "disabled" ? "User reactivated." :
      r.status === "pending_approval" ? "User approved." : "User disabled.";
      return a("tr", { children: [e("td", { children: n.email }), e("td", { children: e("input", { value: r.actorId, onChange: (m) => ca(n.userId, { actorId: m.
      target.value }), "aria-label": `Actor ID for ${n.email}` }) }), e("td", { children: e("input", { value: r.tenantId, onChange: (m) => ca(n.userId, { tenantId: m.
      target.value }), "aria-label": `Tenant ID for ${n.email}` }) }), e("td", { children: e("input", { value: r.roles, onChange: (m) => ca(n.userId, { roles: m.
      target.value }), "aria-label": `Roles for ${n.email}`, placeholder: "reader,pm,admin" }) }), e("td", { children: a("select", { value: r.status, onChange: (m) => ca(
      n.userId, { status: m.target.value }), "aria-label": `Status for ${n.email}`, children: AUTH_USER_STATUS_OPTIONS.map((n2) => e("option", { value: n2.value,
      children: n2.label }, n2.value)) }) }), e("td", { children: n.lastSignInAt || "Never" }), e("td", { children: a("form", { className: "session-form__action\
s", onSubmit: (m) => pi(m, n), children: [e("button", { type: "submit", disabled: ke.kind === "loading", children: "Save" }), e("button", { type: "button", className: "\
button-secondary", disabled: ke.kind === "loading", onClick: () => Oa(n, { status: d }, statusActionMessage), children: statusActionLabel })] }) })] }, n.userId);
    }) })] }) })] }) : a("section", { className: "empty-state", role: "alert", children: [e("h2", { children: "Access denied" }), e("p", { children: "Admin role\
 is required to manage users." })] })] });
}

export {
  AdminUsersRoute
};
