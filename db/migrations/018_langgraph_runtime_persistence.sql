CREATE SCHEMA IF NOT EXISTS langgraph_checkpoint;

CREATE TABLE IF NOT EXISTS langgraph_checkpoint.factory_threads (
  tenant_id VARCHAR(64) NOT NULL,
  factory_run_id VARCHAR(128) NOT NULL,
  thread_id VARCHAR(51) PRIMARY KEY,
  checkpoint_namespace VARCHAR(64) NOT NULL DEFAULT 'factory',
  graph_version VARCHAR(32) NOT NULL,
  state_schema_version SMALLINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  latest_node VARCHAR(64),
  last_checkpoint_id VARCHAR(128),
  checkpoint_size_bytes INTEGER NOT NULL DEFAULT 0,
  lease_owner UUID,
  lease_expires_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  checkpointed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT langgraph_thread_tenant_check CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT langgraph_thread_run_check CHECK (factory_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT langgraph_thread_id_check CHECK (thread_id ~ '^lg_[a-f0-9]{48}$'),
  CONSTRAINT langgraph_thread_namespace_check CHECK (checkpoint_namespace = 'factory'),
  CONSTRAINT langgraph_thread_graph_version_check CHECK (graph_version = 'factory-v1'),
  CONSTRAINT langgraph_thread_state_version_check CHECK (state_schema_version = 1),
  CONSTRAINT langgraph_thread_status_check CHECK (status IN ('active','paused','completed','failed','expired')),
  CONSTRAINT langgraph_thread_latest_node_check CHECK (latest_node IS NULL OR latest_node ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT langgraph_thread_size_check CHECK (checkpoint_size_bytes BETWEEN 0 AND 1048576),
  CONSTRAINT langgraph_thread_lease_check CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT langgraph_thread_retention_check CHECK (retention_expires_at > created_at),
  UNIQUE (tenant_id, factory_run_id, graph_version)
);

COMMENT ON SCHEMA langgraph_checkpoint IS
  'Dedicated LangGraph execution checkpoints. Canonical task and audit stores remain authoritative.';
COMMENT ON TABLE langgraph_checkpoint.factory_threads IS
  'Application-owned tenant binding and sanitized lifecycle registry; raw checkpoint state is never exposed through APIs.';

CREATE INDEX IF NOT EXISTS langgraph_factory_threads_active_idx
  ON langgraph_checkpoint.factory_threads (tenant_id, status, updated_at DESC)
  WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS langgraph_factory_threads_stale_idx
  ON langgraph_checkpoint.factory_threads (status, updated_at)
  WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS langgraph_factory_threads_retention_idx
  ON langgraph_checkpoint.factory_threads (retention_expires_at)
  WHERE status IN ('completed','failed','expired');

REVOKE ALL ON SCHEMA langgraph_checkpoint FROM PUBLIC;
REVOKE ALL ON TABLE langgraph_checkpoint.factory_threads FROM PUBLIC;
