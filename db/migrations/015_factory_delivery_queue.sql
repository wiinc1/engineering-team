CREATE TABLE IF NOT EXISTS factory_delivery_queue (
  tenant_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  title TEXT NOT NULL,
  requirements TEXT NOT NULL,
  template_tier TEXT NOT NULL DEFAULT 'Simple',
  change_kind TEXT,
  changed_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  github_issue_url TEXT,
  stage TEXT NOT NULL DEFAULT 'queued',
  task_id TEXT,
  project_id TEXT,
  project_name TEXT,
  evidence_path TEXT,
  persist_dir TEXT,
  forge_task_id TEXT,
  evidence_status TEXT,
  last_action TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, queue_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (btrim(tenant_id) <> ''),
  CHECK (btrim(queue_id) <> ''),
  CHECK (btrim(idempotency_key) <> ''),
  CHECK (btrim(title) <> ''),
  CHECK (btrim(requirements) <> ''),
  CHECK (btrim(template_tier) <> ''),
  CHECK (attempts >= 0),
  CHECK (max_attempts > 0),
  CHECK (jsonb_typeof(changed_files) = 'array'),
  CHECK (stage IN (
    'queued',
    'intake_complete',
    'phase1_complete',
    'phase6_complete',
    'completed',
    'dead_letter'
  ))
);

CREATE INDEX IF NOT EXISTS idx_factory_delivery_queue_claim
  ON factory_delivery_queue (tenant_id, stage, available_at, created_at, queue_id)
  WHERE stage NOT IN ('completed', 'dead_letter');

CREATE INDEX IF NOT EXISTS idx_factory_delivery_queue_lease
  ON factory_delivery_queue (tenant_id, lease_expires_at)
  WHERE locked_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_factory_delivery_queue_task
  ON factory_delivery_queue (tenant_id, task_id)
  WHERE task_id IS NOT NULL;
