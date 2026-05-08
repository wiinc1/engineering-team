ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS chk_auth_users_status;
ALTER TABLE auth_users
  ADD CONSTRAINT chk_auth_users_status
  CHECK (status IN ('active', 'disabled', 'pending_verification', 'pending_approval', 'invited'));

CREATE TABLE IF NOT EXISTS auth_credentials (
  credential_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_hash_version TEXT NOT NULL,
  force_rehash BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT chk_auth_credentials_hash_nonempty CHECK (char_length(trim(password_hash)) > 0),
  CONSTRAINT chk_auth_credentials_hash_version_nonempty CHECK (char_length(trim(password_hash_version)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_credentials_active_user
  ON auth_credentials (user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_credentials_user_updated
  ON auth_credentials (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS auth_email_verification_tokens (
  token_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  requested_ip_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_auth_email_verification_token_hash_nonempty CHECK (char_length(trim(token_hash)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_auth_email_verification_tokens_user_created
  ON auth_email_verification_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_email_verification_tokens_expiry
  ON auth_email_verification_tokens (expires_at);

CREATE TABLE IF NOT EXISTS auth_password_reset_tokens (
  token_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  requested_ip_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_auth_password_reset_token_hash_nonempty CHECK (char_length(trim(token_hash)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_user_created
  ON auth_password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_expiry
  ON auth_password_reset_tokens (expires_at);

CREATE TABLE IF NOT EXISTS auth_login_failures (
  failure_id UUID PRIMARY KEY,
  email_hash TEXT,
  requested_ip_hash TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_auth_login_failures_reason_nonempty CHECK (char_length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_auth_login_failures_created
  ON auth_login_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_login_failures_email_created
  ON auth_login_failures (email_hash, created_at DESC);
