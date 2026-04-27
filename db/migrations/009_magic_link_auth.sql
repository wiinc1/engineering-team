CREATE TABLE IF NOT EXISTS auth_users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sign_in_at TIMESTAMPTZ,
  CONSTRAINT chk_auth_users_email_nonempty CHECK (char_length(trim(email)) > 0),
  CONSTRAINT chk_auth_users_tenant_nonempty CHECK (char_length(trim(tenant_id)) > 0),
  CONSTRAINT chk_auth_users_actor_nonempty CHECK (char_length(trim(actor_id)) > 0),
  CONSTRAINT chk_auth_users_status CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_auth_users_status ON auth_users (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  link_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  next_path TEXT NOT NULL DEFAULT '/tasks',
  requested_ip_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_magic_links_user_created ON auth_magic_links (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_magic_links_expiry ON auth_magic_links (expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_created ON auth_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  bucket_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_auth_rate_limits_count CHECK (count >= 0)
);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID,
  actor_id TEXT,
  tenant_id TEXT,
  email_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_created ON auth_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_events_type ON auth_audit_events (event_type, created_at DESC);
