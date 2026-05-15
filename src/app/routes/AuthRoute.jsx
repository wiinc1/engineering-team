import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";

function AuthRoute({ ctx }) {
  const {
    At, authMode, AuthPasswordField, authPasswordVisible, authSearchWithMode, bn, C, ci,
    di, E, handleRegistrationSubmit, handleResetConfirmSubmit, handleResetSubmit, i, isEmailVerificationRoute, isPasswordResetRoute,
    It, l, li, M, o, ot, pa, toggleAuthPassword,
    ue, ws, Xt, y, Y, ys
  } = ctx;
  return e("main", { className: "app-shell app-shell--auth", children: a("section", { className: "auth-card", "aria-label": "Sign-in screen", children: [
  a("div", { className: "auth-card__intro", children: [e("p", { className: "eyebrow", children: "Engineering Team" }), e("h1", { children: pa(i) ? "Completing s\
ign-in" : isEmailVerificationRoute(i) ? "Verify email" : isPasswordResetRoute(i) ? "Set a new password" : Xt && authMode === "register" ? "Create your account" :
  Xt && authMode === "resetRequest" ? "Reset your password" : "Sign in to Engineering Team" }), e("p", { className: "lede", children: pa(i) ? "Completing your e\
nterprise sign-in for Engineering Team." : isEmailVerificationRoute(i) ? "Confirming your account email." : isPasswordResetRoute(i) ? "Choose a new password for\
 your Engineering Team account." : Xt ? authMode === "register" ? "Create an account. An admin will approve access before you can use Engineering Team." : authMode ===
  "resetRequest" ? "Enter your account email and we will send reset instructions." : "Access your task workspace and inboxes." : "Use the configured enterprise \
identity provider to access Engineering Team." })] }), bn ? e("p", { className: "auth-status auth-status--notice", role: "status", children: bn }) : null, pa(i) ?
  e("p", { className: "auth-status auth-status--notice", role: "status", children: E.kind === "loading" ? E.message : "Completing enterprise sign-in..." }) : isEmailVerificationRoute(
  i) ? a(q, { children: [e("p", { className: "auth-status auth-status--" + (E.kind === "error" ? "error" : "notice"), role: E.kind === "error" ? "alert" : "stat\
us", children: E.message || "Verifying email..." }), e("button", { type: "button", className: "button-secondary", onClick: () => l(ot, It(ue.next), { replace: true }),
  children: "Return to sign in" })] }) : isPasswordResetRoute(i) ? a("form", { className: "session-form auth-form", onSubmit: handleResetConfirmSubmit, children: [
  e(AuthPasswordField, { id: "resetPassword", name: "resetPassword", label: "New password", value: C.resetPassword, onChange: (t) => y((n) => ({ ...n, resetPassword: t.
  target.value })), autoComplete: "new-password", visible: !!authPasswordVisible.resetPassword, onToggle: () => toggleAuthPassword("resetPassword"), hint: "At l\
east 12 characters with one letter and one number." }), e("div", { className: "session-form__actions", children: e("button", { type: "submit", disabled: E.kind ===
  "loading", children: E.kind === "loading" ? E.message : "Set new password" }) })] }) : a(q, { children: [Xt ? authMode === "register" ? a("form", { className: "\
session-form auth-form", onSubmit: handleRegistrationSubmit, children: [a("label", { children: ["Name", e("input", { name: "displayName", value: C.displayName, onChange: (t) => y(
  (n) => ({ ...n, displayName: t.target.value })), autoComplete: "name" })] }), a("label", { children: ["Email address", e("input", { name: "registrationEmail",
  type: "email", value: C.registrationEmail, onChange: (t) => y((n) => ({ ...n, registrationEmail: t.target.value })), placeholder: C.email || "you@example.com",
  autoComplete: "email", inputMode: "email" })] }), e(AuthPasswordField, { id: "registrationPassword", name: "registrationPassword", label: "Password", value: C.
  registrationPassword, onChange: (t) => y((n) => ({ ...n, registrationPassword: t.target.value })), autoComplete: "new-password", visible: !!authPasswordVisible.
  registrationPassword, onToggle: () => toggleAuthPassword("registrationPassword"), hint: "At least 12 characters with one letter and one number." }), e("div", {
  className: "session-form__actions", children: e("button", { type: "submit", disabled: E.kind === "loading", children: E.kind === "loading" ? E.message : "Crea\
te account" }) }), a("p", { className: "auth-form__footer", children: [e("span", { children: "Already have an account?" }), e("button", { type: "button", className: "\
auth-link-button", onClick: () => {
    M({ kind: "idle", message: "" }), y((t) => ({ ...t, email: t.email || t.registrationEmail })), l(ot, authSearchWithMode(o, "signIn"));
  }, children: "Sign in" })] })] }) : authMode === "resetRequest" ? a("form", { className: "session-form auth-form", onSubmit: handleResetSubmit, children: [a("\
label", { children: ["Email address", e("input", { name: "resetEmail", type: "email", value: C.resetEmail, onChange: (t) => y((n) => ({ ...n, resetEmail: t.target.
  value })), placeholder: C.email || "you@example.com", autoComplete: "email", inputMode: "email" })] }), e("div", { className: "session-form__actions", children: e(
  "button", { type: "submit", disabled: E.kind === "loading", children: E.kind === "loading" ? E.message : "Send reset instructions" }) }), a("p", { className: "\
auth-form__footer", children: [e("button", { type: "button", className: "auth-link-button", onClick: () => {
    M({ kind: "idle", message: "" }), y((t) => ({ ...t, email: t.email || t.resetEmail })), l(ot, authSearchWithMode(o, "signIn"));
  }, children: "Back to sign in" })] })] }) : a("form", { className: "session-form auth-form", onSubmit: di, children: [a("label", { children: ["Email address",
  e("input", { name: "email", type: "email", value: C.email, onChange: (t) => y((n) => ({ ...n, email: t.target.value })), placeholder: "you@example.com", autoComplete: "\
email", inputMode: "email" })] }), e(AuthPasswordField, { id: "password", name: "password", label: "Password", value: C.password, onChange: (t) => y((n) => ({ ...n,
  password: t.target.value })), autoComplete: "current-password", visible: !!authPasswordVisible.password, onToggle: () => toggleAuthPassword("password") }), e(
  "div", { className: "auth-password-links", children: e("button", { type: "button", className: "auth-link-button", onClick: () => {
    M({ kind: "idle", message: "" }), y((t) => ({ ...t, resetEmail: t.resetEmail || t.email })), l(ot, authSearchWithMode(o, "resetRequest"));
  }, children: "Forgot password?" }) }), e("div", { className: "session-form__actions", children: e("button", { type: "submit", disabled: E.kind === "loading", children: E.
  kind === "loading" ? E.message : "Sign in" }) }), a("p", { className: "auth-form__footer", children: [e("span", { children: "New here?" }), e("button", { type: "\
button", className: "auth-link-button", onClick: () => {
    M({ kind: "idle", message: "" }), y((t) => ({ ...t, registrationEmail: t.registrationEmail || t.email })), l(ot, authSearchWithMode(o, "register"));
  }, children: "Create an account" })] })] }) : null, ys ? e("div", { className: "session-form__actions", children: e("button", { type: "button", onClick: ci, disabled: E.
  kind === "loading" || !Y.isOidcConfigured, children: E.kind === "loading" ? E.message : "Continue with enterprise sign-in" }) }) : null, !Xt && !Y.isOidcConfigured ?
  e("p", { className: "auth-status auth-status--error", role: "alert", children: "This deployment has no enabled sign-in method. Contact the production operator\
 to restore the approved login path." }) : null, ws ? a("form", { className: "session-form auth-form", onSubmit: li, children: [a("label", { children: ["Trusted\
 auth code", e("input", { name: "authCode", value: C.authCode, onChange: (t) => y((n) => ({ ...n, authCode: t.target.value })), placeholder: "Paste the signed b\
rowser auth code" })] }), a("label", { children: ["API base URL", e("input", { name: "apiBaseUrl", value: C.apiBaseUrl, onChange: (t) => y((n) => ({ ...n, apiBaseUrl: t.
  target.value })), placeholder: At || "same-origin" })] }), e("div", { className: "session-form__actions", children: e("button", { type: "submit", className: "\
button-secondary", disabled: E.kind === "loading", children: "Use internal bootstrap fallback" }) })] }) : null, E.kind === "error" ? e("p", { className: "auth-\
status auth-status--error", role: "alert", children: E.message }) : null, E.kind === "success" ? e("p", { className: "auth-status auth-status--notice", role: "s\
tatus", children: E.message }) : null] })] }) });
}

export {
  AuthRoute
};
