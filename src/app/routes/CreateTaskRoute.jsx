import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";

function CreateTaskRoute({ ctx }) {
  const {
    appNavClass, appNavToggle, appShellClass, At, collapsedNavRail, h, l, Ma,
    navOpen, Si, sidebarTaskSearch, u, ui, we
  } = ctx;
  return a("main", { className: appShellClass, children: [appNavToggle, collapsedNavRail, a("nav", { id: "primary-navigation", className: appNavClass,
  "aria-label": "Primary navigation", "aria-hidden": !navOpen, inert: navOpen ? void 0 : true, children: [a("div", { className: "app-nav__links", children: [sidebarTaskSearch,
  a("div", { className: "app-nav__primary", role: "group", "aria-label": "Primary task navigation", children: [e("button", { type: "button", className: "button-\
secondary", onClick: () => l("/tasks"), children: "Task workspace" }), e("button", { type: "button", className: "button-secondary", onClick: () => l("/tasks", we(
  { view: "board" }, "")), children: "Kanban board" })] }), a("div", { className: "app-nav__secondary", role: "group", "aria-label": "Secondary workspace naviga\
tion", children: [e("button", { type: "button", className: "button-secondary", onClick: () => l("/overview/pm"), children: "PM overview" })] })] }), a("div", { className: "\
app-nav__session", children: [a("span", { children: [h?.sub || "unknown actor", " \xB7 ", h?.tenant_id || "unknown tenant"] }), e("button", { type: "button", className: "\
button-secondary", onClick: Ma, children: "Sign out" })] })] }), e(Si, { sessionConfig: u, envApiBaseUrl: At, onTaskCreated: ui })] });
}

export {
  CreateTaskRoute
};
