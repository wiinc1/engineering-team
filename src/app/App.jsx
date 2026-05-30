import { Fragment as q, jsx as e, jsxs as a } from "react/jsx-runtime";
import c from "react";
import { createTaskDetailApiClient as fi, toHistoryTimelineItem as yi } from "../features/task-detail/adapter.browser";
import { createTaskDetailPageModule as wi } from "../features/task-detail/route.browser";
import { writeTaskDetailUrlState as In } from "../features/task-detail/urlState";
import { TaskDetailActivityShell as Ni } from "../features/task-detail/TaskDetailActivityShell";
import { StageTransition as Ci } from "../features/task-detail/StageTransition";
import { TaskCreationPage as Si } from "../features/task-creation/TaskCreationPage";
import { beginOidcSignIn as _i, buildOidcLogoutUrl as xi, buildAuthHeaders as ua, completeOidcSignIn as Ri, fetchCurrentSession as Ti, hasSessionExpired as Ai, isAuthenticatedSession as Ii,
logoutSession as Di, readAuthRuntimeConfig as Pi, readBrowserSessionConfig as ma, readSessionClaims as qi, confirmEmailVerification, confirmPasswordReset, loginWithPassword,
registerAccount, requestPasswordReset, resolveApiBaseUrl as Dn, sanitizeNextRoute as Pn, splitRouteTarget as Ha, writeBrowserSessionConfig as Ga } from "./session.browser";
import { buildBoardColumns as Ui, buildGovernanceReviewItems as $i, buildPmOverviewSections as Bi, buildRoleInboxItems as Mi, filterTaskList as Oi, getPmOverviewBucketLabel as qn,
getRoleInboxLabel as H, mapAgentOptions as En, PM_OVERVIEW_BUCKET_ORDER as Un, resolveOwnerPresentation as Li, ROLE_INBOXES as $n, summarizeListResults as Hi, summarizePmOverviewResults as Gi,
summarizeRoleInboxResults as Qi, UNASSIGNED_FILTER_VALUE as Fi } from "./task-owner.mjs";
import { buildBoardStageOrder as zi, canTransitionLifecycleTask as Bn, isLifecycleStage as it, isTaskAssignedToCurrentActor as Qa, matchesTaskSearch as Mn } from "./work-lifecycle.mjs";
import {
  _o, ao, Ao, as, At, AUTH_USER_STATUS_OPTIONS, AUTH_USER_STATUS_VALUES, authModeFromSearch,
  AuthPasswordField, authSearchWithMode, B, bo, co, Co, cs, De,
  Do, ds, Dt, eo, Eo, es, F, Fa,
  Fn, fo, ga, Gn, go, gs, Hn, ho,
  I, Ie, io, Io, is, isEmailVerificationRoute, isPasswordResetRoute, It,
  ja, Ja, ji, Ji, jn, Jn, ka, Ka,
  Ki, Kn, ko, Ln, lo, ls, mo, ms,
  no, No, normalizeAuthUserStatus, ns, On, oo, os, ot,
  pa, Pe, po, Po, ps, Pt, qe, Qn,
  qo, readAuthTokenFromSearch, readNavPanelOpen, ro, Ro, rs, rt, so,
  So, ss, to, To, ts, uo, Uo, us,
  va, Va, Vi, Vn, vo, Wa, we, Wi,
  Wn, wo, writeNavPanelOpen, Xa, Xi, Xn, xo, Ya,
  Yi, Yn, yo, za, Za, Zi, zn, Zn
} from "./app-model.jsx";
import { AuthRoute } from "./routes/AuthRoute.jsx";
import { CreateTaskRoute } from "./routes/CreateTaskRoute.jsx";
import { AdminUsersRoute } from "./routes/AdminUsersRoute.jsx";
import { TaskWorkspaceRoute } from "./routes/TaskWorkspaceRoute.jsx";
import { TaskDetailRoute } from "./routes/TaskDetailRoute.jsx";
import { ProjectsRoute, isProjectsPath } from "./routes/ProjectsRoute.jsx";
import { AutonomyMetricsRoute } from "./routes/AutonomyMetricsRoute.jsx";

function App() {
  const [{ pathname: i, search: o }, l] = Uo(), [u, b] = c.useState(() => ma()), [, S] = c.useState(() => !!(ma().bearerToken || ma().actorId)), [C, y] = c.useState(
  () => eo(ma().apiBaseUrl || At)), [authPasswordVisible, setAuthPasswordVisible] = c.useState({}), [navOpen, setNavOpen] = c.useState(() => readNavPanelOpen()),
  [E, M] = c.useState({ kind: "idle", message: "" }), [V, se] = c.useState(""), [s, O] = c.useState(() => za(i) || Ie(i) || De(i) || Pe(i) || qe(i) ? ja(i, o) :
  so(i) ? Wa(i, o) : Dt(i)), [Ne, ha] = c.useState([]), [lt, qt] = c.useState({ kind: "loading", message: "Loading canonical role roster." }), [Et, en] = c.useState(
  ""), [Ee, Ut] = c.useState({ kind: "idle", message: "" }), [ba, $t] = c.useState({ kind: "idle", message: "" }), [tn, an] = c.useState(""), [nn, sn] = c.useState(
  true), [vs, on] = c.useState({}), [ee, Ue] = c.useState({ kind: "idle", message: "", questionId: null, action: null }), [U, G] = c.useState(() => Fn()), [$e, Bt] = c.
  useState({ kind: "idle", message: "" }), [fa, ya] = c.useState(() => Wn()), [Be, Me] = c.useState({ kind: "idle", message: "" }), [rn, ln] = c.useState(() => jn()),
  [Oe, Le] = c.useState({ kind: "idle", message: "" }), [Mt, wa] = c.useState(() => Vn()), [He, Ge] = c.useState({ kind: "idle", message: "" }), [ct, Na] = c.useState(
  () => Kn()), [Qe, dt] = c.useState({ kind: "idle", message: "" }), [ie, ut] = c.useState(() => Jn()), [Fe, mt] = c.useState({ kind: "idle", message: "" }), [$,
  Ce] = c.useState({ kind: "idle", message: "" }), [oe, ze] = c.useState(() => Yn()), [ks, cn] = c.useState({}), [te, Ot] = c.useState({ kind: "idle", message: "",
  threadId: null, action: null }), [hs, dn] = c.useState({}), [un, mn] = c.useState({}), [R, re] = c.useState(() => Xn()), [We, Lt] = c.useState({ kind: "idle",
  message: "" }), [le, pt] = c.useState(() => Zn()), [je, Ht] = c.useState({ kind: "idle", message: "" }), [gt, Ca] = c.useState(() => es()), [Ve, Gt] = c.useState(
  { kind: "idle", message: "" }), [Q, Se] = c.useState(() => ts()), [Ke, Qt] = c.useState({ kind: "idle", message: "" }), [Sa, pn] = c.useState(() => as()), [Je,
  Ft] = c.useState({ kind: "idle", message: "" }), [vt, _a] = c.useState(() => ns()), [Ye, zt] = c.useState({ kind: "idle", message: "" }), [ce, kt] = c.useState(
  () => ss()), [Xe, Wt] = c.useState({ kind: "idle", message: "" }), [ve, jt] = c.useState(() => is()), [Ze, Vt] = c.useState({ kind: "idle", message: "" }), [xa,
  ht] = c.useState({}), [bs, Kt] = c.useState({}), [de, bt] = c.useState(() => rs()), [et, Jt] = c.useState({ kind: "idle", message: "" }), [T, z] = c.useState(
  () => Ka()), [Ra, gn] = c.useState({}), [K, _e] = c.useState({ kind: "idle", message: "", considerationId: null, action: null }), [J, tt] = c.useState({ kind: "\
idle", message: "", taskId: null }), [vn, Ta] = c.useState(""), [Yt, ft] = c.useState({ taskId: null, overStage: "" }), [fs, kn] = c.useState([]), [ke, he] = c.
  useState({ kind: "idle", message: "" }), [W, at] = c.useState({ email: "", tenantId: "engineering-team", actorId: "", roles: "reader", status: "active" }), [Aa,
  Ia] = c.useState({}), ue = c.useMemo(() => Zi(o), [o]), Y = c.useMemo(() => Pi(import.meta.env), []), h = c.useMemo(() => qi(u), [u]), D = Dn(u, At), X = Ii(u),
  hn = c.useRef(null), Da = c.useRef(false), nt = c.useRef(null), bn = V || to(ue.reason), Xt = Y.productionAuthStrategy === "registration", ys = !Xt, ws = Y.internalAuthBootstrapEnabled &&
  Y.productionAuthStrategy !== "registration", authMode = Xt ? authModeFromSearch(o) : "signIn", toggleAuthPassword = c.useCallback((t) => {
    setAuthPasswordVisible((n) => ({ ...n, [t]: !n[t] }));
  }, []), detailStatusTaskRef = c.useRef(null), Zt = c.useCallback((t, n = "expired") => {
    const r = Ga({ apiBaseUrl: D });
    b(r), y((d) => ({ ...d, apiBaseUrl: r.apiBaseUrl || d.apiBaseUrl })), se(t), l(ot, It(`${i}${o}`, n), { replace: true });
  }, [l, i, D, o]), p = c.useMemo(() => {
    const t = Dn(u, At);
    return fi({ baseUrl: t, fetchImpl: (...n) => window.fetch(...n), getHeaders: () => ua(u), onAuthFailure: () => Zt("Your session expired. Sign in again to co\
ntinue.") });
  }, [Zt, u]), yt = c.useMemo(() => wi({ client: p }), [p]);
  c.useEffect(() => {
    writeNavPanelOpen(navOpen);
  }, [navOpen]), c.useEffect(() => {
    y((t) => ({ ...t, apiBaseUrl: D || t.apiBaseUrl }));
  }, [D]), c.useEffect(() => {
    if (String(u.bearerToken || "").trim() || u.authType === "cookie-session") {
      S(true);
      return;
    }
    let t = false;
    return Ti({ apiBaseUrl: D, fetchImpl: (...n) => window.fetch(...n) }).then((n) => {
      t || (n && b(n), S(true));
    }).catch(() => {
      t || S(true);
    }), () => {
      t = true;
    };
  }, [D, u.authType, u.bearerToken]), c.useEffect(() => {
    if (Ai(u) && String(u.bearerToken || "").trim()) {
      Zt("Your session expired. Sign in again to continue.");
      return;
    }
    if (!X) {
      if (Ln(i) || pa(i) || isEmailVerificationRoute(i) || isPasswordResetRoute(i)) return;
      if (!Xi(i)) {
        l(ot, It("/tasks"), { replace: true });
        return;
      }
      l(ot, It(`${i}${o}`), { replace: true });
      return;
    }
    if (i === "/") {
      l("/tasks", "", { replace: true });
      return;
    }
    if (Ln(i)) {
      const t = Ha(ue.next);
      l(t.pathname, t.search, { replace: true });
    }
  }, [Zt, X, l, i, o, u, ue.next]), c.useEffect(() => {
    if (!pa(i) || X) {
      Da.current = false, nt.current = null;
      return;
    }
    Da.current || (Da.current = true, M({ kind: "loading", message: "Completing enterprise sign-in\u2026" })), nt.current || (nt.current = Ri({ config: Y, search: o,
    fetchImpl: (...n) => window.fetch(...n) }));
    let t = false;
    return nt.current.then((n) => {
      if (t) return;
      nt.current = null, b(n.sessionConfig), se(""), M({ kind: "success", message: "Signed in." });
      const r = Ha(n.next);
      l(r.pathname, r.search, { replace: true });
    }).catch((n) => {
      t || (nt.current = null, se(n?.message || "Enterprise sign-in failed."), M({ kind: "error", message: n?.message || "Enterprise sign-in failed." }), l(ot, It(
      "/tasks", "oidc_error"), { replace: true }));
    }), () => {
      t = true;
    };
  }, [Y, X, l, i, o]), c.useEffect(() => {
    if (!isEmailVerificationRoute(i)) return;
    const t = readAuthTokenFromSearch(o);
    if (!t) {
      M({ kind: "error", message: "Email verification link is missing a token." });
      return;
    }
    let n = false;
    M({ kind: "loading", message: "Verifying email..." }), confirmEmailVerification({ apiBaseUrl: D, token: t, fetchImpl: (...r) => window.fetch(...r) }).then(() => {
      n || M({ kind: "success", message: "Email verified. Sign in with your password." });
    }).catch((r) => {
      n || M({ kind: "error", message: r?.message || "Email verification failed." });
    });
    return () => {
      n = true;
    };
  }, [D, i, o]), c.useLayoutEffect(() => {
    if (s.kind === "detail") {
      const t = s.route?.taskId || null, n = !!s.detail?.task?.id && hn.current !== t, r = detailStatusTaskRef.current !== t;
      n && (hn.current = t), r && (detailStatusTaskRef.current = t), n && (en(s.summary?.currentOwner || ""), an(""), sn(true), on({}), G(Fn(s.detail?.context?.architectHandoff)), ya(Wn(s.detail?.context?.engineerSubmission)),
      ln(jn(s.detail?.context?.skillEscalation)), wa(Vn(s.detail?.context?.activityMonitoring)), Na(Kn(s.detail?.context)), ut(Jn(s.detail?.context)), ze(Yn()),
      cn({}), dn({}), mn({}), re(Xn(s.detail?.context?.qaResults?.latest)), pt(Zn(s.detail?.context?.sreMonitoring)), Ca(es(s.detail?.context?.sreMonitoring)), Se(
      ts(s.detail)), pn(as(s.detail)), _a(ns(s.detail)), kt(ss(s.detail)), jt(is(s.detail)), bt(rs(s.detail)), z(Ka()), gn(vo(s.detail?.context?.deferredConsiderations?.
      unresolved || [])), Ta("")), r && ($t({ kind: "idle", message: "" }), Ut({ kind: "idle", message: "" }), Ue({ kind: "idle", message: "", questionId: null, action: null }),
      Bt({ kind: "idle", message: "" }), Me({ kind: "idle", message: "" }), Le({ kind: "idle", message: "" }), Ge({ kind: "idle", message: "" }), dt({ kind: "id\
le", message: "" }), mt({ kind: "idle", message: "" }), Ce({ kind: "idle", message: "" }), Ot({ kind: "idle", message: "", threadId: null, action: null }), Lt({
      kind: "idle", message: "" }), Ht({ kind: "idle", message: "" }), Gt({ kind: "idle", message: "" }), Qt({ kind: "idle", message: "" }), Ft({ kind: "idle", message: "" }),
      zt({ kind: "idle", message: "" }), Wt({ kind: "idle", message: "" }), Vt({ kind: "idle", message: "" }), ht({}), Kt({}), Jt({ kind: "idle", message: "" }),
      _e({ kind: "idle", message: "", considerationId: null, action: null }), tt({ kind: "idle", message: "", taskId: null }));
    }
  }, [s]), c.useEffect(() => {
    let t = false;
    return X ? ga(i) ? (O(Dt(i)), () => {
      t = true;
    }) : za(i) || Ie(i) || De(i) || Pe(i) || qe(i) ? (O(ja(i, o)), p.fetchTaskList().then((n) => {
      if (t) return;
      const r = va(o), d = Ie(i), m = De(i), v = Pe(i), Z = qe(i);
      O({ kind: "list", route: { pathname: d ? `/inbox/${d.role}` : m ? "/overview/pm" : v ? "/overview/governance" : Z ? "/deferred-considerations" : "/tasks",
      taskId: null }, list: { filters: r, items: n.items || [], state: { kind: "ready" }, resultSummary: "", inboxRole: d?.role || null, isPmOverview: !!m, isGovernanceOverview: !!v,
      isDeferredConsiderations: !!Z } });
    }).catch((n) => {
      if (!t) {
        const r = Ie(i), d = De(i), m = Pe(i), v = qe(i);
        O({ kind: "list", route: { pathname: r ? i : d ? "/overview/pm" : m ? "/overview/governance" : v ? "/deferred-considerations" : "/tasks", taskId: null },
        list: { filters: va(o), items: [], state: { kind: "error", message: n.message || "Task workspace load failed." }, resultSummary: "", inboxRole: r?.role ||
        null, isPmOverview: !!d, isGovernanceOverview: !!m, isDeferredConsiderations: !!v } });
      }
    }), () => {
      t = true;
    }) : yt.match(i) ? (O(Wa(i, o)), yt.load({ pathname: i, search: o }).then((n) => {
      t || O({ ...n, kind: "detail" });
    }).catch((n) => {
      t || O({ ...Dt(i), shell: { ...Dt(i).shell, historyState: { kind: "error", message: n.message || "Task detail load failed." }, telemetryState: { kind: "er\
ror", message: n.message || "Task detail load failed." } } });
    }), () => {
      t = true;
    }) : (O(Dt(i)), () => {
      t = true;
    }) : () => {
      t = true;
    };
  }, [X, yt, i, o, p]), c.useEffect(() => {
    let t = false;
    return X ? (qt({ kind: "loading", message: "Loading canonical role roster." }), (p.fetchAgentRoster || p.fetchAssignableAgents)().then((n) => {
      t || (ha(n.items || n.data || []), qt({ kind: "ready", message: "" }));
    }).catch((n) => {
      t || (ha([]), qt({ kind: "error", message: n?.message || "Canonical role roster unavailable. Role inbox routing cannot be confirmed right now." }));
    }), Ya(h) ? () => {
      t = true;
    } : () => {
      t = true;
    }) : (ha([]), qt({ kind: "idle", message: "" }), () => {
      t = true;
    });
  }, [X, p, h]);
  const Ns = c.useCallback((t) => {
    l(i, In({ tab: t }, o));
  }, [l, i, o]), Cs = c.useCallback((t) => {
    l(i, In({ filters: t }, o));
  }, [l, i, o]), Ss = c.useCallback((t) => {
    l("/tasks", we({ owner: t }, o));
  }, [l, o]), fn = c.useCallback((t) => {
    l("/tasks", we({ view: t }, o));
  }, [l, o]), wt = c.useCallback((t) => {
    l("/tasks", we(t, o));
  }, [l, o]), j = c.useMemo(() => new Map(En(Ne).map((t) => [t.id, t])), [Ne]), _s = s.kind === "detail" && !!s.route?.taskId && Ya(h), xs = s.kind === "detail" &&
  !!s.route?.taskId && us(h), yn = s.kind === "detail" && !!s.route?.taskId && ms(h), wn = s.kind === "detail" && !!s.route?.taskId && Co(h), Rs = s.kind === "d\
etail" && !!s.route?.taskId && So(h), g = s.kind === "detail" && s.route?.taskId || "TSK-42", f = s.kind === "list" ? s.list.inboxRole : null, _ = s.kind === "l\
ist" ? !!s.list.isPmOverview : false, P = s.kind === "list" ? !!s.list.isGovernanceOverview : false, A = s.kind === "list" ? !!s.list.isDeferredConsiderations :
  false, Pa = s.kind === "detail" ? s.detail?.meta?.permissions || {} : {}, Nt = s.kind === "detail" && (s.detail?.context?.executionContract?.approval?.autoApproval ||
  s.detail?.context?.executionContract?.latest?.auto_approval) || null, be = s.kind === "detail" && s.detail?.context?.executionContract?.contractCoverageAudit ||
  null, xe = s.kind === "detail" ? s.detail?.context?.deferredConsiderations || { items: [], unresolved: [], summary: { total: 0, unresolved_count: 0 } } : { items: [],
  unresolved: [], summary: { total: 0, unresolved_count: 0 } }, Ts = s.kind === "detail" && Do(h), As = s.kind === "detail" && Po(h), ea = s.kind === "detail" &&
  !!s.detail?.reviewQuestions, Is = ea && No(h) && s.detail?.task?.stage === "ARCHITECT_REVIEW", Nn = ea && Ro(h), Cn = ea && To(h), Sn = ea && Ao(h), me = go(fa),
  Re = s.kind === "detail" && yo(s.detail?.task?.stage || s.summary.currentStage), Ds = s.kind === "detail" ? qo(s.detail) : null, qa = wn && Ds === "Jr" && !Re &&
  !s.detail?.context?.engineerSubmission, pe = s.kind === "detail" && s.detail?.context?.activityMonitoring || null, $o = s.kind === "detail" && s.detail?.context?.
  transferredContext || null, _n = s.kind === "detail" && !!s.route?.taskId && (Ya(h) || ms(h) || us(h) || I(h, ["qa", "contributor", "admin"])), fe = s.kind ===
  "detail" && s.detail?.meta?.lock || null, ta = s.kind === "detail" ? s.detail?.activity?.workflowThreads?.items || [] : [], aa = s.kind === "detail" ? s.detail?.
  activity?.workflowThreads?.summary || { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0, resolvedCount: 0 } : { total: 0, unresolvedCount: 0, unresolvedBlockingCount: 0,
  resolvedCount: 0 }, xn = s.kind === "detail" && I(h, ["architect", "engineer", "qa", "pm", "contributor", "admin"]), Ps = s.kind === "detail" && s.detail?.task?.
  stage === "QA_TESTING" && I(h, ["qa", "admin", "contributor"]), w = s.kind === "detail" && s.detail?.context?.sreMonitoring || null, na = s.kind === "detail" &&
  s.detail?.task?.stage === "SRE_MONITORING" && _o(h), qs = na, Ea = s.kind === "detail" && s.detail?.context?.closeGovernance || null, sa = s.kind === "detail" &&
  !!Ea?.active, Rn = s.kind === "detail" && s.detail?.task?.stage === "BACKLOG" && s.detail?.context?.pmBusinessContextReview?.finalized === false && !!s.detail?.
  context?.anomalyChildTask && !!s.detail?.relations?.parentTask, Es = s.kind === "detail" && xo(h) && s.detail?.task?.stage === "BACKLOG" && Rn, Us = sa && ps(
  h), $s = sa && ps(h), Bs = sa && gs(h) && Ea?.humanDecision?.decisionReady !== false, Ms = f === "human" && gs(h), Os = sa && Ea?.backtrack?.available && Io(h),
  Ls = cs(oe.commentType, oe.blocking), st = s.kind === "detail" && s.detail?.context?.qaResults?.latest || null, Ct = s.kind === "detail" && (s.detail?.context?.
  qaResults?.items || []).find((t) => t.outcome === "fail") || null, Hs = s.kind === "detail" && s.detail?.context?.implementationHistory?.[0]?.version || 0, ia = Ct &&
  Hs > (Ct.implementationVersion || 0) ? { priorRunId: Ct.runId, priorQaActorId: Ct.submittedBy || null, scope: Ct.reTestScope || [] } : null, Ua = fo(R), Gs = R.
  outcome === "pass" ? "SRE monitoring" : "implementation fix loop", L = s.kind === "detail" ? { task_id: s.route?.taskId || s.detail?.task?.id || s.summary.taskId,
  current_stage: s.detail?.task?.stage || s.summary.currentStage, current_owner: s.detail?.summary?.owner?.id || s.summary.currentOwner || null, owner: s.detail?.
  summary?.owner ? { actor_id: s.detail.summary.owner.id, display_name: s.detail.summary.owner.label } : null } : null, oa = s.kind === "detail" && Pt(s.detail ||
  s.summary), Qs = L ? Qa(L, h, j) : false, k = c.useCallback(async () => {
    if (s.kind === "list") {
      O(ja(i, o));
      const n = await p.fetchTaskList(), r = Ie(i), d = De(i), m = Pe(i), v = qe(i);
      O({ kind: "list", route: { pathname: r ? `/inbox/${r.role}` : d ? "/overview/pm" : m ? "/overview/governance" : v ? "/deferred-considerations" : "/tasks",
      taskId: null }, list: { filters: va(o), items: n.items || [], state: { kind: "ready" }, resultSummary: "", inboxRole: r?.role || null, isPmOverview: !!d, isGovernanceOverview: !!m,
      isDeferredConsiderations: !!v } });
      return;
    }
    O(Wa(i, o));
    const t = await yt.load({ pathname: i, search: o });
    O({ ...t, kind: "detail" });
  }, [s.kind, yt, i, o, p]), St = c.useCallback((t, n) => {
    gn((r) => ({ ...r, [t]: { ...ka(), ...r[t] || {}, ...n } }));
  }, []), Fs = c.useCallback(async (t) => {
    t.preventDefault();
    const n = s.kind === "detail" ? s.route?.taskId : null;
    if (n) {
      _e({ kind: "loading", message: "Capturing Deferred Consideration.", considerationId: null, action: "capture" });
      try {
        await p.captureDeferredConsideration(n, { title: T.title, knownContext: T.knownContext, rationale: T.rationale, sourceSection: T.sourceSection, sourceComment: T.
        sourceComment, sourceAgent: T.sourceAgent, owner: T.owner, revisitTrigger: T.revisitTrigger, revisitDate: T.revisitDate, openQuestions: B(T.openQuestions) }),
        z(Ka()), _e({ kind: "success", message: "Deferred Consideration captured.", considerationId: null, action: "capture" }), await k();
      } catch (r) {
        _e({ kind: "error", message: r?.message || "Deferred Consideration capture failed.", considerationId: null, action: "capture" });
      }
    }
  }, [T, s, k, p]), $a = c.useCallback(async (t, n) => {
    const r = s.kind === "detail" ? s.route?.taskId : null, d = t?.id || t?.deferred_consideration_id;
    if (!r || !d) return;
    const m = Ra[d] || ka(t);
    _e({ kind: "loading", message: "Updating Deferred Consideration.", considerationId: d, action: n });
    try {
      n === "leave_deferred" ? await p.reviewDeferredConsideration(r, d, { action: "leave_deferred", reviewNote: m.reviewNote || "Deferred Consideration reviewe\
d and left deferred.", revisitTrigger: m.revisitTrigger, revisitDate: m.revisitDate }) : n === "promote" ? await p.promoteDeferredConsideration(r, d, { title: m.
      promotionTitle || t.title, promotionNote: m.promotionNote }) : n === "close" && await p.closeDeferredConsideration(r, d, { rationale: m.closeRationale }),
      _e({ kind: "success", message: "Deferred Consideration updated.", considerationId: d, action: n }), await k();
    } catch (v) {
      _e({ kind: "error", message: v?.message || "Deferred Consideration update failed.", considerationId: d, action: n });
    }
  }, [Ra, s, k, p]), _t = c.useCallback(async ({ item: t, toStage: n, note: r = "", source: d = "board" }) => {
    if (!t?.task_id) return;
    const m = Bn(t, n, h, j);
    if (!m.allowed) {
      tt({ kind: "error", message: m.reason, taskId: t.task_id });
      return;
    }
    const v = String(r || "").trim();
    if (String(n || "").toUpperCase() === "REOPEN" && !v) {
      tt({ kind: "error", message: "A finding note is required before reopening a task.", taskId: t.task_id });
      return;
    }
    tt({ kind: "loading", message: `Moving ${t.task_id} to ${n}\u2026`, taskId: t.task_id });
    try {
      await p.changeTaskStage(t.task_id, n, { from_stage: t.current_stage, ...v ? { note: v, rationale: v } : {}, source: d }), await k(), tt({ kind: "success",
      message: `${t.task_id} moved to ${n}.`, taskId: t.task_id }), String(n || "").toUpperCase() === "REOPEN" && Ta("");
    } catch (Z) {
      tt({ kind: "error", message: Z?.message || `Task transition to ${n} failed.`, taskId: t.task_id });
    }
  }, [j, k, p, h]), zs = c.useCallback(async (t, n) => {
    if (ft({ taskId: null, overStage: "" }), !t || !it(n) || !it(t.current_stage) || t.current_stage === n) return;
    let r = "";
    n === "REOPEN" && (r = window.prompt(`Add a finding note for ${t.task_id}`, "") || ""), await _t({ item: t, toStage: n, note: r, source: "board-dnd" });
  }, [_t]), Ws = c.useCallback(async () => {
    if (s.kind !== "detail" || !g) return;
    const t = s.shell.historyPageInfo, n = t?.next_cursor;
    if (!(!t?.has_more || !n)) {
      $t({ kind: "loading", message: "" });
      try {
        const r = await p.fetchTaskHistory(g, { filters: s.shell.filters, pagination: { limit: Number.isFinite(t.limit) ? t.limit : 25, cursor: n }, range: { dateFrom: s.
        shell.filters?.dateFrom, dateTo: s.shell.filters?.dateTo } });
        O((d) => {
          if (d.kind !== "detail") return d;
          const m = (r.items || []).map(yi);
          return { ...d, shell: { ...d.shell, historyItems: [...d.shell.historyItems, ...m], historyPageInfo: r.page_info || { next_cursor: null, has_more: false } } };
        }), $t({ kind: "success", message: "" });
      } catch (r) {
        $t({ kind: "error", message: r?.message || "Loading more history failed." });
      }
    }
  }, [s, g, p]), js = c.useCallback((t, n) => {
    on((r) => ({ ...r, [t]: n }));
  }, []), ra = c.useCallback(async ({ action: t, questionId: n = null, payload: r, successMessage: d }) => {
    if (g) {
      Ue({ kind: "loading", message: "Saving review question update\u2026", questionId: n, action: t });
      try {
        t === "ask" ? await p.askReviewQuestion(g, r) : t === "answer" ? await p.answerReviewQuestion(g, n, r) : t === "resolve" ? await p.resolveReviewQuestion(
        g, n, r) : t === "reopen" && await p.reopenReviewQuestion(g, n, r), await k(), Ue({ kind: "success", message: d, questionId: n, action: t });
      } catch (m) {
        Ue({ kind: "error", message: m?.message || "Review question update failed.", questionId: n, action: t });
      }
    }
  }, [k, g, p]), Vs = c.useCallback((t, n) => {
    cn((r) => ({ ...r, [t]: n }));
  }, []), Ks = c.useCallback((t) => {
    dn((n) => ({ ...n, [t]: !n[t] }));
  }, []), Js = c.useCallback((t) => {
    mn((n) => ({ ...n, [t]: !n[t] }));
  }, []), la = c.useCallback(async ({ action: t, threadId: n = null, payload: r, successMessage: d }) => {
    if (g) {
      Ot({ kind: "loading", message: "Saving workflow thread update\u2026", threadId: n, action: t });
      try {
        t === "create" ? await p.createWorkflowThread(g, r) : t === "reply" ? await p.replyToWorkflowThread(g, n, r) : t === "resolve" ? await p.resolveWorkflowThread(
        g, n, r) : t === "reopen" && await p.reopenWorkflowThread(g, n, r), await k(), Ot({ kind: "success", message: d, threadId: n, action: t });
      } catch (m) {
        Ot({ kind: "error", message: m?.message || "Workflow thread update failed.", threadId: n, action: t });
      }
    }
  }, [k, g, p]), Ba = c.useCallback(async () => {
    if (g) {
      Ce({ kind: "loading", message: "Acquiring task lock\u2026" });
      try {
        await p.acquireTaskLock(g, { reason: "Manual task detail editing session", action: "task_detail_edit" }), await k(), Ce({ kind: "success", message: "Tas\
k lock acquired." });
      } catch (t) {
        Ce({ kind: "error", message: t?.message || "Task lock acquisition failed." });
      }
    }
  }, [k, g, p]), Ys = c.useCallback(async () => {
    if (g) {
      Ce({ kind: "loading", message: "Releasing task lock\u2026" });
      try {
        await p.releaseTaskLock(g), await k(), Ce({ kind: "success", message: "Task lock released." });
      } catch (t) {
        Ce({ kind: "error", message: t?.message || "Task lock release failed." });
      }
    }
  }, [k, g, p]), Xs = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Lt({ kind: "loading", message: "Submitting QA result\u2026" });
      try {
        await p.submitQaResult(g, { outcome: R.outcome, summary: R.summary, scenarios: B(R.scenarios), findings: B(R.findings), reproductionSteps: B(R.reproductionSteps),
        stackTraces: B(R.stackTraces), envLogs: B(R.envLogs), retestScope: B(R.retestScope) }), await k(), Lt({ kind: "success", message: R.outcome === "pass" ?
        "QA approved the task and routed it to SRE monitoring." : "QA failure routed the task back to implementation." });
      } catch (n) {
        Lt({ kind: "error", message: n?.message || "QA result submission failed." });
      }
    }
  }, [R, k, g, p]), Zs = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Ht({ kind: "loading", message: "Starting monitoring window\u2026" });
      try {
        await p.startSreMonitoring(g, { deploymentEnvironment: le.deploymentEnvironment, deploymentUrl: le.deploymentUrl, deploymentVersion: le.deploymentVersion,
        evidence: B(le.evidence) }), await k(), Ht({ kind: "success", message: "SRE monitoring window started." });
      } catch (n) {
        Ht({ kind: "error", message: n?.message || "SRE monitoring could not be started." });
      }
    }
  }, [k, g, le, p]), ei = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Gt({ kind: "loading", message: "Recording early approval\u2026" });
      try {
        await p.approveSreMonitoring(g, { reason: gt.reason, evidence: B(gt.evidence) }), await k(), Gt({ kind: "success", message: "SRE early approval recorded\
." });
      } catch (n) {
        Gt({ kind: "error", message: n?.message || "SRE approval failed." });
      }
    }
  }, [k, g, gt, p]), ti = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Qt({ kind: "loading", message: "Creating anomaly child task\u2026" });
      try {
        const n = await p.createMonitoringAnomalyChildTask(g, { title: Q.title, service: Q.service, anomalySummary: Q.anomalySummary, metrics: B(Q.metrics), logs: B(
        Q.logs), errorSamples: B(Q.errorSamples) });
        await k(), Qt({ kind: "success", message: `Anomaly child task ${n?.data?.childTaskId || "created"} linked to the parent and routed back to PM context re\
view.` });
      } catch (n) {
        Qt({ kind: "error", message: n?.message || "Monitoring anomaly child task creation failed." });
      }
    }
  }, [Q, k, g, p]), ai = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Ft({ kind: "loading", message: "Finalizing PM business context\u2026" });
      try {
        await p.completePmBusinessContext(g, { businessContext: Sa.businessContext }), await k(), Ft({ kind: "success", message: "PM business context review com\
pleted. Architect work can now begin." });
      } catch (n) {
        Ft({ kind: "error", message: n?.message || "PM business context review failed." });
      }
    }
  }, [Sa.businessContext, k, g, p]), ni = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      zt({ kind: "loading", message: "Recording cancellation recommendation\u2026" });
      try {
        await p.submitCloseCancellationRecommendation(g, { summary: vt.summary, rationale: vt.rationale }), await k(), zt({ kind: "success", message: "Cancellat\
ion recommendation recorded." });
      } catch (n) {
        zt({ kind: "error", message: n?.message || "Cancellation recommendation failed." });
      }
    }
  }, [vt, k, g, p]), si = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Wt({ kind: "loading", message: "Escalating exceptional dispute\u2026" });
      try {
        await p.submitExceptionalDispute(g, { summary: ce.summary, rationale: ce.rationale, recommendation: ce.recommendation, severity: ce.severity }), await k(),
        Wt({ kind: "success", message: "Exceptional dispute escalated for human review." });
      } catch (n) {
        Wt({ kind: "error", message: n?.message || "Exceptional dispute escalation failed." });
      }
    }
  }, [ce, k, g, p]), ii = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Vt({ kind: "loading", message: "Recording human close decision\u2026" });
      try {
        await p.submitHumanCloseDecision(g, { outcome: ve.outcome, summary: ve.summary, rationale: ve.rationale, confirmationRequired: ve.outcome !== "approve" }),
        await k(), Vt({ kind: "success", message: "Human close decision recorded." });
      } catch (n) {
        Vt({ kind: "error", message: n?.message || "Human close decision failed." });
      }
    }
  }, [ve, k, g, p]), oi = c.useCallback(async (t, n) => {
    t.preventDefault();
    const r = n?.task_id;
    if (!r) return;
    const d = xa[r] || os(n);
    Kt((m) => ({ ...m, [r]: { kind: "loading", message: "Recording human close decision\u2026" } }));
    try {
      await p.submitHumanCloseDecision(r, { outcome: d.outcome, summary: d.summary, rationale: d.rationale, confirmationRequired: d.outcome !== "approve" }), ht(
      (m) => {
        const v = { ...m };
        return delete v[r], v;
      }), await k(), Kt((m) => ({ ...m, [r]: { kind: "success", message: "Human close decision recorded." } }));
    } catch (m) {
      Kt((v) => ({ ...v, [r]: { kind: "error", message: m?.message || "Human close decision failed." } }));
    }
  }, [xa, k, p]), ri = c.useCallback(async (t) => {
    if (t.preventDefault(), !!g) {
      Jt({ kind: "loading", message: "Backtracking close review to implementation\u2026" });
      try {
        const n = await p.submitCloseReviewBacktrack(g, { reasonCode: de.reasonCode, rationale: de.rationale, agreementArtifact: de.agreementArtifact, summary: de.
        summary });
        await k();
        const r = n?.data?.awaitingRole;
        Jt({ kind: "success", message: r ? `Backtrack recommendation recorded. ${r === "pm" ? "PM" : "Architect"} approval is still required.` : "Close review b\
acktracked to implementation." });
      } catch (n) {
        Jt({ kind: "error", message: n?.message || "Close review backtrack failed." });
      }
    }
  }, [de, k, g, p]), li = c.useCallback(async (t) => {
    t.preventDefault();
    const n = String(C.apiBaseUrl || "").trim().replace(/\/+$/, ""), r = String(C.authCode || "").trim();
    M({ kind: "loading", message: "Signing in\u2026" });
    try {
      const d = await no({ apiBaseUrl: n, authCode: r }), m = ao(d, n);
      b(m), se(""), M({ kind: "success", message: "Signed in." });
      const v = Ha(ue.next);
      l(v.pathname, v.search, { replace: true });
    } catch (d) {
      M({ kind: "error", message: d?.message || "Sign-in failed." });
    }
  }, [l, C, ue.next]), ci = c.useCallback(async () => {
    M({ kind: "loading", message: "Redirecting to enterprise sign-in\u2026" });
    try {
      await _i({ config: Y, next: ue.next, apiBaseUrl: String(C.apiBaseUrl || D || "").trim().replace(/\/+$/, ""), fetchImpl: (...t) => window.fetch(...t) });
    } catch (t) {
      M({ kind: "error", message: t?.message || "Enterprise sign-in failed." });
    }
  }, [Y, D, C.apiBaseUrl, ue.next]), di = c.useCallback(async (t) => {
    t.preventDefault(), M({ kind: "loading", message: "Signing in..." });
    try {
      const n = String(C.apiBaseUrl || D || "").trim().replace(/\/+$/, "");
      const r = await loginWithPassword({ apiBaseUrl: n, email: C.email, password: C.password, next: ue.next, fetchImpl: (...d2) => window.fetch(...d2) });
      b(r), se(""), M({ kind: "success", message: "Signed in." });
      const d = Ha(ue.next);
      l(d.pathname, d.search, { replace: true });
    } catch (n) {
      y((r) => ({ ...r, password: "" })), M({ kind: "error", message: n?.message || "Sign-in failed." });
    }
  }, [D, C.apiBaseUrl, C.email, C.password, ue.next, l]), handleRegistrationSubmit = c.useCallback(async (t) => {
    t.preventDefault(), M({ kind: "loading", message: "Creating account..." });
    try {
      const n = String(C.apiBaseUrl || D || "").trim().replace(/\/+$/, "");
      const r = await registerAccount({ apiBaseUrl: n, email: C.registrationEmail || C.email, password: C.registrationPassword, displayName: C.displayName, inviteCode: "",
      fetchImpl: (...d) => window.fetch(...d) });
      y((d) => ({ ...d, registrationPassword: "" })), M({ kind: "success", message: r.message || "If registration is available for that email, next steps have b\
een sent." });
    } catch (n) {
      M({ kind: "error", message: n?.message || "Registration failed." });
    }
  }, [D, C.apiBaseUrl, C.registrationEmail, C.email, C.registrationPassword, C.displayName]), handleResetSubmit = c.useCallback(async (t) => {
    t.preventDefault(), M({ kind: "loading", message: "Sending reset instructions..." });
    try {
      const n = String(C.apiBaseUrl || D || "").trim().replace(/\/+$/, "");
      const r = await requestPasswordReset({ apiBaseUrl: n, email: C.resetEmail || C.email, fetchImpl: (...d) => window.fetch(...d) });
      M({ kind: "success", message: r.message || "If the email is eligible, password reset instructions have been sent." });
    } catch (n) {
      M({ kind: "error", message: n?.message || "Password reset request failed." });
    }
  }, [D, C.apiBaseUrl, C.resetEmail, C.email]), handleResetConfirmSubmit = c.useCallback(async (t) => {
    t.preventDefault(), M({ kind: "loading", message: "Resetting password..." });
    try {
      const n = String(C.apiBaseUrl || D || "").trim().replace(/\/+$/, ""), r = readAuthTokenFromSearch(o);
      await confirmPasswordReset({ apiBaseUrl: n, token: r, password: C.resetPassword, fetchImpl: (...d) => window.fetch(...d) }), y((d) => ({ ...d, resetPassword: "" })),
      M({ kind: "success", message: "Password reset complete. Sign in with your new password." }), l(ot, It(ue.next), { replace: true });
    } catch (n) {
      M({ kind: "error", message: n?.message || "Password reset failed." });
    }
  }, [D, C.apiBaseUrl, C.resetPassword, o, l, ue.next]), Ma = c.useCallback(async () => {
    const t = xi(Y);
    if (u.authType === "cookie-session") try {
      await Di({ apiBaseUrl: D, fetchImpl: (...r) => window.fetch(...r) });
    } catch (r) {
      se(r?.message || "Sign-out failed."), M({ kind: "error", message: r?.message || "Sign-out failed." });
      return;
    }
    const n = Ga({ apiBaseUrl: D });
    if (b(n), y((r) => ({ ...r, apiBaseUrl: n.apiBaseUrl || r.apiBaseUrl, authCode: "" })), se(""), M({ kind: "idle", message: "" }), t) {
      window.location.assign(t);
      return;
    }
    l(ot, It("/tasks", "signed_out"), { replace: true });
  }, [Y, l, D, u.authType]), ui = c.useCallback((t) => {
    const n = t?.taskId || t?.data?.taskId || null;
    l(n ? `/tasks/${encodeURIComponent(n)}` : "/tasks", n ? "?created=intake-draft" : "");
  }, [l]), Te = c.useCallback(async () => {
    he({ kind: "loading", message: "Loading users." });
    try {
      const t = await window.fetch(`${D}/auth/users`, { credentials: "same-origin", headers: ua(u) }), n = await t.json();
      if (!t.ok) throw new Error(n?.error?.message || "User load failed.");
      const r = n.data || [];
      kn(r), Ia(wo(r)), he({ kind: "ready", message: "" });
    } catch (t) {
      kn([]), Ia({}), he({ kind: "error", message: t?.message || "User load failed." });
    }
  }, [D, u]), mi = c.useCallback(async (t) => {
    t.preventDefault(), he({ kind: "loading", message: "Saving user." });
    try {
      const n = await window.fetch(`${D}/auth/users`, { method: "POST", credentials: "same-origin", headers: { ...ua(u), "content-type": "application/json" }, body: JSON.
      stringify({ email: W.email, tenantId: W.tenantId, actorId: W.actorId, roles: Xa(W.roles), status: W.status }) }), r = await n.json();
      if (!n.ok) throw new Error(r?.error?.message || "User save failed.");
      at({ email: "", tenantId: W.tenantId || "engineering-team", actorId: "", roles: "reader", status: "active" }), await Te();
    } catch (n) {
      he({ kind: "error", message: n?.message || "User save failed." });
    }
  }, [W, Te, D, u]), ca = c.useCallback((t, n) => {
    Ia((r) => ({ ...r, [t]: { ...r[t], ...n } }));
  }, []), Oa = c.useCallback(async (t, n = {}, r = "User updated.") => {
    if (!t?.userId) return;
    const d = { ...Za(t), ...Aa[t.userId] || {}, ...n };
    he({ kind: "loading", message: "Saving user." });
    try {
      const m = await window.fetch(`${D}/auth/users/${encodeURIComponent(t.userId)}`, { method: "PATCH", credentials: "same-origin", headers: { ...ua(u), "conte\
nt-type": "application/json" }, body: JSON.stringify({ tenantId: d.tenantId, actorId: d.actorId, roles: Xa(d.roles), status: d.status }) }), v = await m.json().
      catch(() => ({}));
      if (!m.ok) throw new Error(v?.error?.message || "User update failed.");
      await Te(), he({ kind: "success", message: r });
    } catch (m) {
      he({ kind: "error", message: m?.message || "User update failed." });
    }
  }, [Aa, Te, D, u]), pi = c.useCallback(async (t, n) => {
    t.preventDefault(), await Oa(n, {}, "User updated.");
  }, [Oa]);
  c.useEffect(() => {
    X && ga(i) && I(h, ["admin"]) && Te();
  }, [X, Te, i, h]);
  const projectRouteActive = isProjectsPath(i), autonomyMetricsRouteActive = ((i || "").replace(/\/+$/, "") || "/") === "/metrics/autonomous-delivery", N = s.kind === "list" ? s.list.filters : { owner: "", view: "list", bucket: "", priority: "", status: "", searchTerm: "", project: "" }, Ae = s.kind === "list" ? Oi(
  s.list.items, { owner: N.owner, priority: N.priority, status: N.status, searchTerm: N.searchTerm, project: N.project }) : [], gi = c.useMemo(() => s.kind === "list" ? Array.from(
  new Set(s.list.items.map((t) => String(t.priority || "").trim()).filter(Boolean))).sort() : [], [s]), projectOptions = c.useMemo(() => s.kind === "list" ? Array.from(new Map(s.list.items.map((t) => t.project).filter(Boolean).map((t) => [t.projectId, t])).values()).sort((t, n) => t.name.localeCompare(n.name)) : [], [s]), vi = c.useMemo(() => s.kind === "list" ? zi(s.list.items) :
  [], [s]), La = !!(N.owner || N.priority || N.status || N.searchTerm || N.project), ye = s.kind === "list" && f ? Mi(s.list.items, f, j) : [], Tn = s.kind === "list" && _ ?
  Bi(s.list.items, j) : [], xt = s.kind === "list" && P ? $i(s.list.items, j) : [], Rt = s.kind === "list" && A ? ko(s.list.items) : [], ki = A ? bo(Rt) : [], ae = _ &&
  Un.includes(N.bucket) ? N.bucket : "", An = ae && Tn.find((t) => t.key === ae) || null, da = _ ? ae ? An?.items.length ? [An] : [] : Tn.filter((t) => t.items.
  length > 0) : [], hi = s.kind === "list" ? Ui(s.list.items, Ae, j) : [], x = s.kind === "list" ? s.list.state : { kind: "idle" }, ne = f ? x.kind !== "ready" ?
  { kind: x.kind, message: x.message || "" } : lt.kind === "loading" ? { kind: "loading", message: `Loading ${H(f)} inbox routing.` } : lt.kind === "error" ? { kind: "\
error", message: `${lt.message} ${H(f)} inbox counts stay hidden until canonical owner-to-role mapping is available.` } : { kind: "ready", message: "" } : { kind: "\
idle", message: "" }, bi = s.kind === "list" ? _ ? Gi(da, ae) : P ? `${xt.length} governance review${xt.length === 1 ? "" : "s"} shown.` : A ? `${Rt.length} Def\
erred Consideration${Rt.length === 1 ? "" : "s"} awaiting PM review.` : f ? ne.kind === "ready" ? Qi(ye.length, f) : ne.message : Hi(Ae.length, N.owner, j, N.view) :
  "", sidebarTaskSearch = a("form", { className: "app-nav__search", role: "search", "aria-label": "Task search", onSubmit: (t) => {
    t.preventDefault();
    const n = String(new FormData(t.currentTarget).get("q") || "").trim(), r = za(i) ? o : "";
    l("/tasks", we({ searchTerm: n }, r));
  }, children: [a("label", { children: [e("span", { children: "Search tasks" }), e("input", { name: "q", "aria-label": "Search tasks", defaultValue: N.searchTerm,
  placeholder: "Task ID or title", autoComplete: "off" })] }), e("button", { type: "submit", children: "Search" })] }, `task-search-${N.searchTerm}`), appShellClass = `\
app-shell${navOpen ? "" : " app-shell--nav-collapsed"}`, appNavClass = `app-nav${navOpen ? "" : " app-nav--collapsed"}`, appNavToggle = e("button", { type: "but\
ton", className: "app-nav-toggle", "aria-label": navOpen ? "Collapse navigation" : "Open navigation", "aria-controls": "primary-navigation", "aria-expanded": navOpen,
  title: navOpen ? "Collapse navigation" : "Open navigation", onClick: () => setNavOpen((t) => !t), children: e("span", { className: "app-nav-toggle__icon", "ar\
ia-hidden": "true" }) }), collapsedTaskWorkspaceSelected = s.kind === "list" && !_ && !P && !A && !f && N.view !== "board", collapsedKanbanSelected = s.kind ===
  "list" && !_ && !P && !A && !f && N.view === "board", collapsedNavRail = navOpen ? null : a("nav", { className: "app-nav-rail", "aria-label": "Collapsed navig\
ation", children: [a("button", { type: "button", className: `app-nav-rail__item${collapsedTaskWorkspaceSelected ? " app-nav-rail__item--active" : ""}`, "aria-la\
bel": "Task workspace", "aria-pressed": collapsedTaskWorkspaceSelected, title: "Task workspace", onClick: () => l("/tasks", we({ view: "list" }, "")), children: [
  e("span", { className: "app-nav-rail__icon", "aria-hidden": "true", children: "W" }), e("span", { className: "app-nav-rail__label", children: "Task workspace" })] }),
  a("button", { type: "button", className: `app-nav-rail__item${collapsedKanbanSelected ? " app-nav-rail__item--active" : ""}`, "aria-label": "Kanban board", "a\
ria-pressed": collapsedKanbanSelected, title: "Kanban board", onClick: () => l("/tasks", we({ view: "board" }, "")), children: [e("span", { className: "app-nav-\
rail__icon", "aria-hidden": "true", children: "K" }), e("span", { className: "app-nav-rail__label", children: "Kanban board" })] }), a("button", { type: "button",
  className: `app-nav-rail__item${Hn(i) ? " app-nav-rail__item--active" : ""}`, "aria-label": "New task", "aria-pressed": Hn(i), title: "New task", onClick: () => l(
  "/tasks/create"), children: [e("span", { className: "app-nav-rail__icon", "aria-hidden": "true", children: "+" }), e("span", { className: "app-nav-rail__label",
  children: "New task" })] }), a("button", { type: "button", className: `app-nav-rail__item${isProjectsPath(i) ? " app-nav-rail__item--active" : ""}`, "aria-label": "Projects", "aria-pressed": isProjectsPath(i), title: "Projects", onClick: () => l("/projects"), children: [e("span", { className: "app-nav-rail__icon", "aria-hidden": "true", children: "P" }), e("span", { className: "app-nav-rail__label", children: "Projects" })] }), a("button", { type: "button", className: `app-nav-rail__item${_ ? " app-nav-rail__item--active" : ""}`, "aria-label": "PM overvie\
w", "aria-pressed": _, title: "PM overview", onClick: () => l("/overview/pm"), children: [e("span", { className: "app-nav-rail__icon", "aria-hidden": "true", children: "\
P" }), e("span", { className: "app-nav-rail__label", children: "PM overview" })] }), a("button", { type: "button", className: `app-nav-rail__item${P ? " app-nav\
-rail__item--active" : ""}`, "aria-label": "Governance reviews", "aria-pressed": P, title: "Governance reviews", onClick: () => l("/overview/governance"), children: [
  e("span", { className: "app-nav-rail__icon", "aria-hidden": "true", children: "G" }), e("span", { className: "app-nav-rail__label", children: "Governance revi\
ews" })] }), a("button", { type: "button", className: `app-nav-rail__item${f === "pm" ? " app-nav-rail__item--active" : ""}`, "aria-label": "PM inbox", "aria-pr\
essed": f === "pm", title: "PM inbox", onClick: () => l("/inbox/pm"), children: [e("span", { className: "app-nav-rail__icon", "aria-hidden": "true", children: "\
I" }), e("span", { className: "app-nav-rail__label", children: "PM inbox" })] }), a("button", { type: "button", className: "app-nav-rail__item", "aria-label": "\
Search tasks", "aria-controls": "primary-navigation", "aria-expanded": navOpen, title: "Search tasks", onClick: () => setNavOpen(true), children: [e("span", { className: "\
app-nav-rail__icon", "aria-hidden": "true", children: a("svg", { viewBox: "0 0 20 20", focusable: "false", children: [e("circle", { cx: "8.5", cy: "8.5", r: "5.\
25", fill: "none", stroke: "currentColor", strokeWidth: "1.8" }), e("path", { d: "m12.25 12.25 4 4", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "\
round" })] }) }), e("span", { className: "app-nav-rail__label", children: "Search tasks" })] })] });
  const routeContext = {
    _, _a, _n, _s, _t, $, $a, $e,
    $s, A, aa, Aa, ae, Ae, ai, an,
    appNavClass, appNavToggle, appShellClass, As, at, At, AUTH_USER_STATUS_OPTIONS, authMode, autonomyMetricsRouteActive,
    AuthPasswordField, authPasswordVisible, authSearchWithMode, B, ba, Ba, be, Be,
    bi, bn, Bn, bs, Bs, bt, Bt, C,
    ca, Ca, ce, ci, Ci, Cn, co, collapsedNavRail,
    cs, Cs, ct, D, da, de, di, ds, dt,
    E, ee, Ee, ei, en, En, Eo, Es,
    et, Et, f, F, fa, fe, Fe, Fi,
    fn, fs, Fs, ft, g, G, Ge, gi,
    Gn, Gs, gt, h, H, handleRegistrationSubmit, handleResetConfirmSubmit, handleResetSubmit,
    He, hi, hs, ht, i, I, ia, ie,
    ii, io, Is, isEmailVerificationRoute, isPasswordResetRoute, it, It, j,
    J, Ja, je, Je, js, Js, jt, k,
    K, ka, ke, Ke, ki, ks, Ks, kt,
    l, L, la, La, le, Le, li, Li,
    ln, lo, ls, Ls, lt, M, Ma, me,
    Me, mi, Mn, mo, Ms, mt, Mt, N,
    na, Na, navOpen, ne, Ne, ni, Ni, nn,
    Nn, Ns, Nt, o, oa, Oa, oe, Oe,
    oi, On, oo, os, Os, ot, p, P,
    pa, Pa, pe, pi, pn, po, projectOptions, projectRouteActive, Ps, pt,
    Pt, Q, qa, Qa, Qe, qn, Qn, qs,
    Qs, R, ra, Ra, re, Re, ri, rn,
    Rn, ro, Rs, rt, Rt, s, Sa, Se,
    si, Si, sidebarTaskSearch, sn, Sn, Ss, st, St,
    T, ta, Ta, te, Te, ti, tn, toggleAuthPassword,
    Ts, u, U, Ua, ue, Ue, ui, un,
    Un, uo, Us, ut, Ut, V, Va, ve,
    Ve, vi, vn, vs, Vs, vt, w, W,
    wa, we, We, wn, ws, Ws, wt, x,
    xa, xe, Xe, xn, xs, Xs, xt, Xt,
    y, Y, ya, ye, Ye, yn, ys, Ys,
    Yt, z, Za, ze, Ze, zn, zs, Zs,
  };

  if (!X) return e(AuthRoute, { ctx: routeContext });
  ;
  if (Hn(i)) return e(CreateTaskRoute, { ctx: routeContext });
  if (ga(i)) return e(AdminUsersRoute, { ctx: routeContext })
  return a("main", { className: appShellClass, children: [appNavToggle, collapsedNavRail, a("nav", { id: "primary-navigation", className: appNavClass, "aria-lab\
el": "Primary navigation", "aria-hidden": !navOpen, inert: navOpen ? void 0 : true, children: [a("div", { className: "app-nav__links", children: [sidebarTaskSearch,
  a("div", { className: "app-nav__primary", role: "group", "aria-label": "Primary task navigation", children: [e("button", { type: "button", className: s.kind ===
  "list" && !_ && !P && !A && !f && !autonomyMetricsRouteActive && N.view !== "board" ? "" : "button-secondary", "aria-pressed": s.kind === "list" && !_ && !P && !A && !f && !autonomyMetricsRouteActive && N.view !== "board",
  onClick: () => l("/tasks", we({ view: "list" }, "")), children: "Task workspace" }), e("button", { type: "button", className: s.kind === "list" && !_ && !P &&
  !A && !f && !autonomyMetricsRouteActive && N.view === "board" ? "" : "button-secondary", "aria-pressed": s.kind === "list" && !_ && !P && !A && !f && !autonomyMetricsRouteActive && N.view === "board", onClick: () => l("/\
tasks", we({ view: "board" }, "")), children: "Kanban board" }), e("button", { type: "button", className: projectRouteActive ? "" : "button-secondary", "aria-pressed": projectRouteActive, onClick: () => l("/projects"), children: "Projects" }), e("button", { type: "button", className: "app-nav__primary-action", onClick: () => l("/tasks/cr\
eate"), children: "New task" })] }), a("div", { className: "app-nav__secondary", role: "group", "aria-label": "Secondary workspace navigation", children: [e("bu\
tton", { type: "button", className: _ ? "" : "button-secondary", onClick: () => l("/overview/pm"), children: "PM overview" }), e("button", { type: "button", className: P ?
  "" : "button-secondary", onClick: () => l("/overview/governance"), children: "Governance reviews" }), e("button", { type: "button", className: A ? "" : "butto\
n-secondary", onClick: () => l("/deferred-considerations"), children: "Deferred considerations" }), e("button", { type: "button", className: autonomyMetricsRouteActive ? "" : "button-secondary", onClick: () => l("/metrics/autonomous-delivery"), children: "Autonomy metrics" }), I(h, ["admin"]) ? e("button", { type: "button", className: "\
button-secondary", onClick: () => l("/admin/users"), children: "User admin" }) : null, a("label", { className: "app-nav__role-select", children: [e("span", { children: "\
Role inboxes" }), a("select", { "aria-label": "Role inboxes", value: f || "", onChange: (t) => {
    const n = t.target.value;
    n && l("/inbox/" + n);
  }, children: [e("option", { value: "", children: "Select inbox" }), $n.map((t) => a("option", { value: t, children: [H(t), " inbox"] }, t))] })] })] })] }), a(
  "div", { className: "app-nav__session", children: [a("span", { children: [h?.sub || "unknown actor", " \xB7 ", h?.tenant_id || "unknown tenant"] }), e("button",
  { type: "button", className: "button-secondary", onClick: Ma, children: "Sign out" })] })] }), V ? e("p", { className: "auth-status auth-status--error", role: "\
alert", children: V }) : null, a("header", { className: "page-header", children: [a("div", { children: [e("p", { className: "eyebrow", children: "Authenticated \
browser shell for US-002" }), e("h1", { children: autonomyMetricsRouteActive ? "Autonomous Delivery Metrics" : projectRouteActive ? "Projects" : s.kind === "list" ? _ ? "PM Overview" : P ? "Governance Reviews" : A ? "Deferred Considerations" : f ? `${H(f)}\
 Inbox` : "Task workspace" : s.detail?.task?.title || s.summary.title || "Task detail" }), e("p", { className: "lede", children: autonomyMetricsRouteActive ? "Pilot report for clean autonomous delivery, operator intervention, rework, rollback, and escaped-defect signals." : projectRouteActive ? "Plan and inspect task planning containers without changing task lifecycle ownership." : s.kind === "list" ? _ ? "Read-o\
nly grouped overview showing routed, unassigned, and attention-needed work from the canonical owner-role mapping." : P ? "Dedicated operational surface for inac\
tivity and governance review tasks that should stay out of delivery queues." : A ? "PM review queue for non-committed ideas that are explicitly outside the curr\
ent approved scope." : f ? f === "sre" ? "Read-only monitoring inbox showing tasks routed here because they are in the SRE monitoring stage or explicitly assign\
ed to SRE-owned work." : `Read-only inbox surface showing tasks routed here because the current assigned owner maps to the ${H(f)} role.` : "Task workspace show\
ing Kanban board and list projections over the same lifecycle, with owner, priority, status, and search filters." : "Review blockers, ownership, readiness, and \
audit activity for the selected task." })] })] }), autonomyMetricsRouteActive ? e(AutonomyMetricsRoute, { ctx: routeContext }) : projectRouteActive ? e(ProjectsRoute, { ctx: routeContext }) : s.kind === "list" ? e(TaskWorkspaceRoute, { ctx: routeContext }) : e(TaskDetailRoute, { ctx: routeContext })] });
}
export { App };
