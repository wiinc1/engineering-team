CREATE SCHEMA IF NOT EXISTS runtime_control;

CREATE TABLE IF NOT EXISTS runtime_control.ownership_epochs (
  scope VARCHAR(16) NOT NULL,
  epoch UUID NOT NULL,
  engine VARCHAR(16) NOT NULL,
  revision CHAR(40) NOT NULL,
  state VARCHAR(16) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  evidence_digest VARCHAR(71) NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  PRIMARY KEY (scope, epoch),
  CONSTRAINT runtime_ownership_scope_check CHECK (scope IN ('jobs','factory')),
  CONSTRAINT runtime_ownership_engine_check CHECK (engine IN ('graphile','langgraph','legacy')),
  CONSTRAINT runtime_ownership_state_check CHECK (state IN ('frozen','active','retired')),
  CONSTRAINT runtime_ownership_revision_check CHECK (revision ~ '^[0-9a-f]{40}$'),
  CONSTRAINT runtime_ownership_evidence_check CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_ownership_one_current_idx
  ON runtime_control.ownership_epochs (scope)
  WHERE state IN ('frozen','active');

CREATE TABLE IF NOT EXISTS runtime_control.migration_records (
  scope VARCHAR(16) NOT NULL,
  epoch UUID NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  semantic_id VARCHAR(128) NOT NULL,
  source_engine VARCHAR(16) NOT NULL,
  target_engine VARCHAR(16) NOT NULL,
  source_state VARCHAR(32) NOT NULL,
  disposition VARCHAR(32) NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  evidence_code VARCHAR(64) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, epoch, tenant_id, semantic_id),
  FOREIGN KEY (scope, epoch) REFERENCES runtime_control.ownership_epochs(scope, epoch),
  CONSTRAINT runtime_migration_outcome_check CHECK (outcome IN ('planned','reconciled','quarantined','failed'))
);

REVOKE ALL ON SCHEMA runtime_control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA runtime_control FROM PUBLIC;
COMMENT ON TABLE runtime_control.ownership_epochs IS 'Immutable, revision/evidence-bound exclusive runtime ownership history.';
COMMENT ON TABLE runtime_control.migration_records IS 'Payload-free reconciliation evidence retained after executable legacy queues are removed.';
