const MERGE_READINESS_SOURCE_POLICY_VERSION = "merge-readiness-source-inventory.v1";
const PASSING_CHECK_CONCLUSION = "success";
const FAILING_CHECK_CONCLUSION = "failure";

function readAny(input, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) return input[key];
  }
  return undefined;
}

function toArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",").map(item => item.trim()).filter(Boolean);
  if (typeof value === "object") return Object.values(value).flatMap(toArray);
  return [];
}

function slug(value) {
  return String(value || "source").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
}

function changedFilePath(value) {
  return String(value?.path || value?.filename || value?.file || value || "").trim();
}

function sourceOwner(type, preferred = "repo") {
  if (["deployment_evidence", "runtime_observability"].includes(type)) return "sre";
  if (type === "policy_configuration") return "repo-admin";
  return preferred;
}

function addRequired(sources, source) {
  const current = sources.get(source.id);
  if (!current) {
    sources.set(source.id, { required: true, policy_version: MERGE_READINESS_SOURCE_POLICY_VERSION, ...source });
    return;
  }
  current.reasons = [...new Set([...(current.reasons || []), ...(source.reasons || [])])];
}

function requiredSource(id, type, label, reasons, extra = {}) {
  return {
    id,
    type,
    label,
    owner: sourceOwner(type, extra.owner),
    reasons,
    ...extra,
  };
}

function requiredCheckName(check) {
  return String(check?.name || check?.checkName || check?.context || check || "").trim();
}

function evidenceIdentity(evidence) {
  const label = String(evidence?.id || evidence?.name || evidence?.type || evidence || "execution-contract-evidence").trim();
  return { id: `execution-contract:${slug(label)}`, label };
}

function selectFileSources(required, files) {
  if (!files.length) return;
  addRequired(required, requiredSource("pr-diff", "pull_request_diff", "Pull request changed-file inventory", ["changed_files"]));
  const joined = files.join("\n").toLowerCase();
  if (/(^|\n)(lib|src|api|scripts|db\/migrations)\//.test(joined)) {
    addRequired(required, requiredSource("repo-standards", "standards_log", "Repo standards verification", ["runtime_or_governance_files"]));
  }
  if (/(^|\n)(src\/|tests\/browser\/|tests\/accessibility\/|tests\/visual\/)/.test(joined)) {
    addRequired(required, requiredSource("browser-validation", "browser_validation", "Browser and accessibility validation", ["browser_surface_files"]));
  }
  if (/(^|\n)(db\/migrations\/|lib\/task-platform\/|scripts\/.*task-platform)/.test(joined)) {
    addRequired(required, requiredSource("migration-plan", "migration_plan", "Migration and rollout evidence", ["data_or_task_platform_files"]));
  }
  if (/(auth|security|jwt|permission|policy)/.test(joined)) {
    addRequired(required, requiredSource("security-review", "security_review", "Security review evidence", ["security_sensitive_files"], { owner: "repo-admin" }));
  }
}

function selectCheckSources(required, checks) {
  for (const check of checks) {
    const name = requiredCheckName(check);
    if (!name) continue;
    addRequired(required, requiredSource(`check:${slug(name)}`, "github_check", name, ["required_checks"], {
      source_url: check?.sourceUrl || check?.url || check?.detailsUrl || null,
      conclusion: check?.conclusion || check?.status || null,
    }));
  }
}

function selectExecutionContractSources(required, evidenceItems) {
  for (const evidence of evidenceItems) {
    const identity = evidenceIdentity(evidence);
    addRequired(required, requiredSource(identity.id, "execution_contract_evidence", identity.label, ["execution_contract_evidence"], {
      owner: evidence?.owner || "repo",
      source_url: evidence?.sourceUrl || evidence?.url || null,
    }));
  }
}

function selectDeploymentSources(required, input) {
  const preview = readAny(input, "previewDeployment", "preview_deployment", "preview");
  const deployment = readAny(input, "deployment", "deploymentEvidence", "deployment_evidence");
  if (preview) {
    addRequired(required, requiredSource("preview-deployment", "preview_evidence", "Preview deployment evidence", ["preview_presence"], {
      source_url: preview?.url || preview?.sourceUrl || (typeof preview === "string" ? preview : null),
    }));
  }
  if (!deployment) return;
  addRequired(required, requiredSource("deployment-evidence", "deployment_evidence", "Deployment evidence", ["deployment_presence"], {
    source_url: deployment?.url || deployment?.sourceUrl || (typeof deployment === "string" ? deployment : null),
  }));
  addRequired(required, requiredSource("runtime-observability", "runtime_observability", "Runtime observability evidence", ["deployment_presence"]));
}

function selectRiskSources(required, riskFlags) {
  const flags = riskFlags.map(flag => slug(flag));
  if (flags.some(flag => ["security", "auth", "privacy", "permission"].includes(flag))) {
    addRequired(required, requiredSource("security-review", "security_review", "Security review evidence", ["risk_flags"], { owner: "repo-admin" }));
  }
  if (flags.some(flag => ["data", "schema", "migration"].includes(flag))) {
    addRequired(required, requiredSource("migration-plan", "migration_plan", "Migration and rollout evidence", ["risk_flags"]));
  }
  if (flags.some(flag => ["deployment", "production", "sre", "runtime"].includes(flag))) {
    addRequired(required, requiredSource("deployment-evidence", "deployment_evidence", "Deployment evidence", ["risk_flags"]));
    addRequired(required, requiredSource("runtime-observability", "runtime_observability", "Runtime observability evidence", ["risk_flags"]));
  }
  if (flags.includes("accessibility")) {
    addRequired(required, requiredSource("accessibility-validation", "accessibility_validation", "Accessibility validation", ["risk_flags"]));
  }
  if (flags.includes("performance")) {
    addRequired(required, requiredSource("performance-validation", "performance_validation", "Performance validation", ["risk_flags"]));
  }
}

function selectRequiredSources(input = {}) {
  const required = new Map();
  selectFileSources(required, toArray(readAny(input, "changedFiles", "changed_files")).map(changedFilePath).filter(Boolean));
  selectCheckSources(required, toArray(readAny(input, "requiredChecks", "required_checks", "requiredCheckInventory", "required_check_inventory")));
  selectExecutionContractSources(required, toArray(readAny(input, "executionContractEvidence", "execution_contract_evidence")));
  selectDeploymentSources(required, input);
  selectRiskSources(required, toArray(readAny(input, "riskFlags", "risk_flags")));
  return [...required.values()];
}

function sourceRef(source = {}) {
  return [source.id, source.sourceId, source.source_id, source.type, source.name, source.label, source.url, source.sourceUrl, source.source_url]
    .filter(Boolean).map(value => String(value));
}

function availableRefs(input = {}) {
  const refs = new Set();
  const sources = [
    ...toArray(readAny(input, "availableSources", "available_sources")),
    ...toArray(readAny(input, "reviewedLogSources", "reviewed_log_sources")),
  ];
  for (const source of sources) for (const ref of sourceRef(source)) refs.add(ref);
  return refs;
}

function accessMap(input = {}) {
  const value = readAny(input, "evidenceAccess", "evidence_access", "sourceAccess", "source_access");
  if (!value) return new Map();
  if (!Array.isArray(value) && typeof value === "object") return new Map(Object.entries(value));
  return new Map(toArray(value).map(item => [String(item.id || item.sourceId || item.source_id || item.type || ""), item]));
}

function accessState(source, map) {
  const entry = map.get(source.id) || map.get(source.type) || null;
  if (!entry) return null;
  if (entry === false || entry.status === "inaccessible" || entry.accessible === false) {
    return {
      status: "inaccessible",
      reason: entry.reason || entry.reason_code || "inaccessible",
      details: entry.details || null,
    };
  }
  return null;
}

function classifyRequiredSource(source, refs, access) {
  const blocked = accessState(source, access);
  if (blocked) return { ...source, status: "inaccessible", access_reason: blocked.reason, access_details: blocked.details };
  if (source.source_url || refs.has(source.id) || refs.has(source.type) || refs.has(source.label)) {
    return { ...source, status: "present" };
  }
  return { ...source, status: "missing" };
}

function policyBlockedOwner(source, reason) {
  if (source.owner === "sre") return "sre";
  if (/config|permission|forbidden|credential|token/i.test(reason || "")) return "repo-admin";
  return source.owner || "repo";
}

function buildFindings(requiredSources) {
  const findings = [];
  for (const source of requiredSources.filter(item => item.status === "missing")) {
    findings.push({ id: `MRR-SOURCE-MISSING-${slug(source.id)}`, type: "missing_required_source", severity: "blocker", sourceId: source.id, policyVersion: MERGE_READINESS_SOURCE_POLICY_VERSION, summary: `${source.label} is required by merge-readiness policy and was not provided.` });
  }
  for (const source of requiredSources.filter(item => item.status === "inaccessible")) {
    findings.push({ id: `MRR-SOURCE-INACCESSIBLE-${slug(source.id)}`, type: "required_evidence_inaccessible", severity: "error", sourceId: source.id, policyVersion: MERGE_READINESS_SOURCE_POLICY_VERSION, summary: `${source.label} is required but cannot be accessed.` });
  }
  return findings;
}

function buildPolicyBlockedExceptions(requiredSources) {
  return requiredSources.filter(item => item.status === "inaccessible" && /config|permission|forbidden|credential|token/i.test(item.access_reason || "")).map(item => ({
    type: "policy_blocked",
    status: "open",
    sourceId: item.id,
    owner: policyBlockedOwner(item, item.access_reason),
    reason: item.access_reason,
    policyVersion: MERGE_READINESS_SOURCE_POLICY_VERSION,
  }));
}

function evaluateMergeReadinessSourcePolicy(input = {}) {
  const refs = availableRefs(input);
  const access = accessMap(input);
  const requiredSources = selectRequiredSources(input).map(source => classifyRequiredSource(source, refs, access));
  const missing = requiredSources.filter(source => source.status === "missing");
  const inaccessible = requiredSources.filter(source => source.status === "inaccessible");
  const status = inaccessible.length ? "error" : missing.length ? "blocked" : "satisfied";
  const optionalSources = toArray(readAny(input, "optionalSources", "optional_sources", "availableSources", "available_sources"))
    .filter(source => !requiredSources.some(required => sourceRef(source).includes(required.id) || sourceRef(source).includes(required.type)));
  return {
    policyVersion: MERGE_READINESS_SOURCE_POLICY_VERSION,
    status,
    reviewStatus: status === "error" ? "error" : status === "blocked" ? "blocked" : null,
    mergeReadinessCheck: { name: "Merge readiness", conclusion: status === "satisfied" ? PASSING_CHECK_CONCLUSION : FAILING_CHECK_CONCLUSION },
    requiredSources,
    optionalSources,
    findings: buildFindings(requiredSources),
    exceptions: buildPolicyBlockedExceptions(requiredSources),
  };
}

function mergeObject(base, additions) {
  return base && typeof base === "object" && !Array.isArray(base) ? { ...base, ...additions } : additions;
}

function applyMergeReadinessSourcePolicy(review, input = {}) {
  const policy = evaluateMergeReadinessSourcePolicy({ ...input, reviewedLogSources: review.reviewed_log_sources, requiredCheckInventory: review.required_check_inventory });
  review.source_inventory = mergeObject(review.source_inventory, {
    policy_version: policy.policyVersion,
    status: policy.status,
    required_sources: policy.requiredSources,
    optional_sources: policy.optionalSources,
  });
  review.classification = mergeObject(review.classification, {
    source_inventory_policy: {
      version: policy.policyVersion,
      status: policy.status,
      missing_required_source_ids: policy.requiredSources.filter(source => source.status === "missing").map(source => source.id),
      inaccessible_required_source_ids: policy.requiredSources.filter(source => source.status === "inaccessible").map(source => source.id),
      exceptions: policy.exceptions,
      merge_readiness_check: policy.mergeReadinessCheck,
    },
  });
  review.metadata = mergeObject(review.metadata, { merge_readiness_check: policy.mergeReadinessCheck });
  review.findings = [...toArray(review.findings), ...policy.findings, ...policy.exceptions.map(exception => ({ ...exception, severity: "blocker" }))];
  if (policy.reviewStatus) review.review_status = policy.reviewStatus;
  return review;
}

module.exports = {
  MERGE_READINESS_SOURCE_POLICY_VERSION,
  applyMergeReadinessSourcePolicy,
  evaluateMergeReadinessSourcePolicy,
  selectRequiredSources,
};
