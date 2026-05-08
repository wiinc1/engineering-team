DROP TABLE IF EXISTS auth_login_failures;
DROP TABLE IF EXISTS auth_password_reset_tokens;
DROP TABLE IF EXISTS auth_email_verification_tokens;
DROP TABLE IF EXISTS auth_credentials;

UPDATE auth_users
SET status = 'disabled'
WHERE status NOT IN ('active', 'disabled');

ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS chk_auth_users_status;
ALTER TABLE auth_users
  ADD CONSTRAINT chk_auth_users_status
  CHECK (status IN ('active', 'disabled'));
