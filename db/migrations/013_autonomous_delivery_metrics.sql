CREATE TABLE IF NOT EXISTS autonomous_delivery_retrospective_signals (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  task_class TEXT,
  template_tier TEXT,
  implementation_agent TEXT,
  approval_mode TEXT,
  final_outcome_status TEXT,
  classification_status TEXT NOT NULL,
  excluded_from_thresholds BOOLEAN NOT NULL DEFAULT FALSE,
  operator_intervention_count INTEGER NOT NULL DEFAULT 0,
  qa_sre_rework_count INTEGER NOT NULL DEFAULT 0,
  rollback_recorded BOOLEAN NOT NULL DEFAULT FALSE,
  escaped_defect_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, task_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_signals_tenant_generated
  ON autonomous_delivery_retrospective_signals (tenant_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_signals_filter
  ON autonomous_delivery_retrospective_signals (
    tenant_id,
    task_class,
    template_tier,
    implementation_agent,
    classification_status
  );

CREATE TABLE IF NOT EXISTS autonomous_delivery_metric_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  filters JSONB NOT NULL,
  summary JSONB NOT NULL,
  breakdowns JSONB NOT NULL,
  threshold_evaluations JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_snapshots_tenant_generated
  ON autonomous_delivery_metric_snapshots (tenant_id, generated_at DESC);
