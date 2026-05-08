const crypto = require('node:crypto');
const { ROLE_PERMISSIONS } = require('../audit/authz');
const { createPgPoolFromEnv } = require('../audit/postgres');
const {
  PASSWORD_HASH_VERSION,
  hashPassword,
  needsPasswordRehash,
  validatePasswordPolicy,
  verifyPassword,
} = require('./credentials');

const SESSION_COOKIE = 'engineering_team_session';
const CSRF_COOKIE = 'engineering_team_csrf';
const DEFAULT_NEXT = '/tasks';
const DEFAULT_SESSION_TTL_HOURS = 8;
const DEFAULT_EMAIL_VERIFICATION_TTL_HOURS = 24;
const DEFAULT_PASSWORD_RESET_TTL_MINUTES = 30;
const GENERIC_REGISTRATION_MESSAGE = 'If registration is available for that email, next steps have been sent.';
const GENERIC_PASSWORD_RESET_MESSAGE = 'If the email is eligible, password reset instructions have been sent.';
const GENERIC_EMAIL_VERIFICATION_MESSAGE = 'If the email is eligible, verification instructions have been sent.';
const GENERIC_LOGIN_FAILURE = 'Unable to sign in with those credentials.';
const USER_STATUSES = Object.freeze(['active', 'disabled', 'pending_verification', 'pending_approval', 'invited']);
const REGISTRATION_MODES = Object.freeze(['open', 'invite-only', 'admin-approved', 'disabled']);
const DUMMY_PASSWORD_HASH = hashPassword('DummyPassword123!');

function nowDate(nowMs = Date.now()) {
  return new Date(nowMs);
}

function sha256(value, secret = '') {
  return crypto.createHash('sha256').update(`${secret}:${value}`).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRoles(value = []) {
  const allowed = new Set(Object.keys(ROLE_PERMISSIONS));
  const roles = Array.isArray(value) ? value : String(value || '').split(',');
  const normalized = [...new Set(roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean))];
  const invalid = normalized.filter((role) => !allowed.has(role));
  if (invalid.length) {
    throw createAuthError(400, 'invalid_auth_roles', `Invalid auth roles: ${invalid.join(', ')}`);
  }
  return normalized.length ? normalized : ['reader'];
}

function normalizeStatus(value = 'active') {
  const status = String(value || 'active').trim().toLowerCase();
  if (!USER_STATUSES.includes(status)) {
    throw createAuthError(400, 'invalid_auth_status', `Invalid auth status: ${status}`);
  }
  return status;
}

function normalizeRegistrationMode(value = 'admin-approved') {
  const mode = String(value || 'admin-approved').trim().toLowerCase();
  if (!REGISTRATION_MODES.includes(mode)) {
    throw createAuthError(500, 'invalid_registration_mode', `Unsupported registration mode: ${mode}`);
  }
  return mode;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function sanitizeNextPath(value) {
  const candidate = String(value || '').trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return DEFAULT_NEXT;
  const withoutHash = candidate.split('#')[0];
  if (
    !withoutHash ||
    withoutHash.startsWith('/sign-in') ||
    withoutHash.startsWith('/auth/magic-link') ||
    withoutHash.startsWith('/auth/login') ||
    withoutHash.startsWith('/auth/register')
  ) {
    return DEFAULT_NEXT;
  }
  return withoutHash;
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || '')}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

function isMutatingMethod(method = '') {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

function createAuthError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function buildPublicAppUrl(options = {}) {
  return String(options.publicAppUrl || process.env.AUTH_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

function actorIdForEmail(email) {
  return `user-${crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
}

function createMemoryRegistrationStore() {
  const users = new Map();
  const credentials = new Map();
  const sessions = new Map();
  const rateLimits = new Map();
  const emailVerificationTokens = new Map();
  const passwordResetTokens = new Map();
  const loginFailures = [];
  const auditEvents = [];

  return {
    kind: 'memory',
    async upsertUser(input) {
      const email = normalizeEmail(input.email);
      const existing = [...users.values()].find((user) => user.email === email);
      const user = {
        userId: existing?.userId || input.userId || crypto.randomUUID(),
        email,
        tenantId: String(input.tenantId ?? existing?.tenantId ?? '').trim(),
        actorId: String(input.actorId ?? existing?.actorId ?? '').trim(),
        roles: normalizeRoles(input.roles ?? existing?.roles ?? ['reader']),
        status: normalizeStatus(input.status ?? existing?.status ?? 'active'),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSignInAt: existing?.lastSignInAt || null,
      };
      users.set(user.userId, user);
      return user;
    },
    async listUsers() {
      return [...users.values()].sort((left, right) => left.email.localeCompare(right.email));
    },
    async countUsers() {
      return users.size;
    },
    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === normalizeEmail(email)) || null;
    },
    async findUserById(userId) {
      return users.get(userId) || null;
    },
    async setUserStatus(userId, status) {
      const user = users.get(userId);
      if (!user) return null;
      user.status = normalizeStatus(status);
      user.updatedAt = new Date().toISOString();
      return user;
    },
    async upsertCredential(input) {
      const existing = [...credentials.values()].find((credential) => credential.userId === input.userId);
      const credential = {
        credentialId: existing?.credentialId || input.credentialId || crypto.randomUUID(),
        userId: input.userId,
        passwordHash: input.passwordHash,
        passwordHashVersion: input.passwordHashVersion || PASSWORD_HASH_VERSION,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastVerifiedAt: existing?.lastVerifiedAt || null,
        forceRehash: !!input.forceRehash,
        revokedAt: null,
      };
      credentials.set(credential.credentialId, credential);
      return credential;
    },
    async findCredentialByUserId(userId) {
      return [...credentials.values()].find((credential) => credential.userId === userId && !credential.revokedAt) || null;
    },
    async markCredentialVerified(credentialId, at) {
      const credential = credentials.get(credentialId);
      if (credential) credential.lastVerifiedAt = at.toISOString();
    },
    async createEmailVerificationToken(record) {
      emailVerificationTokens.set(record.tokenId, record);
      return record;
    },
    async findEmailVerificationTokenByHash(tokenHash) {
      return [...emailVerificationTokens.values()].find((token) => token.tokenHash === tokenHash) || null;
    },
    async consumeEmailVerificationToken(tokenId, at) {
      const token = emailVerificationTokens.get(tokenId);
      if (!token || token.consumedAt) return null;
      token.consumedAt = at.toISOString();
      return token;
    },
    async createPasswordResetToken(record) {
      passwordResetTokens.set(record.tokenId, record);
      return record;
    },
    async findPasswordResetTokenByHash(tokenHash) {
      return [...passwordResetTokens.values()].find((token) => token.tokenHash === tokenHash) || null;
    },
    async consumePasswordResetToken(tokenId, at) {
      const token = passwordResetTokens.get(tokenId);
      if (!token || token.consumedAt) return null;
      token.consumedAt = at.toISOString();
      return token;
    },
    async createSession(record) {
      sessions.set(record.sessionId, record);
      return record;
    },
    async findSessionByHash(sessionHash) {
      return [...sessions.values()].find((session) => session.sessionHash === sessionHash) || null;
    },
    async revokeSession(sessionId, at) {
      const session = sessions.get(sessionId);
      if (session) session.revokedAt = at.toISOString();
    },
    async revokeUserSessions(userId, at) {
      for (const session of sessions.values()) {
        if (session.userId === userId && !session.revokedAt) session.revokedAt = at.toISOString();
      }
    },
    async touchUserSignIn(userId, at) {
      const user = users.get(userId);
      if (user) {
        user.lastSignInAt = at.toISOString();
        user.updatedAt = at.toISOString();
      }
    },
    async touchSession(sessionId, at) {
      const session = sessions.get(sessionId);
      if (session) session.lastSeenAt = at.toISOString();
    },
    async incrementRateLimit(bucketKey, bucketType, windowMs, limit, at) {
      const existing = rateLimits.get(bucketKey);
      if (!existing || at.valueOf() - Date.parse(existing.windowStart) >= windowMs) {
        rateLimits.set(bucketKey, {
          bucketKey,
          bucketType,
          count: 1,
          windowStart: at.toISOString(),
          updatedAt: at.toISOString(),
        });
        return { count: 1, limited: false };
      }
      existing.count += 1;
      existing.updatedAt = at.toISOString();
      return { count: existing.count, limited: existing.count > limit };
    },
    async recordLoginFailure(record) {
      loginFailures.push({
        failureId: crypto.randomUUID(),
        emailHash: record.emailHash || null,
        requestedIpHash: record.requestedIpHash || null,
        reason: record.reason || 'invalid_credentials',
        createdAt: new Date().toISOString(),
      });
    },
    async recordAudit(event) {
      auditEvents.push({
        ...event,
        eventId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
    },
    async getSecuritySummary() {
      return {
        users: users.size,
        credentials: credentials.size,
        activeSessions: [...sessions.values()].filter((session) => !session.revokedAt).length,
        rateLimitBuckets: rateLimits.size,
        loginFailures: loginFailures.length,
        auditEvents: auditEvents.length,
      };
    },
    get auditEvents() {
      return auditEvents;
    },
    get loginFailures() {
      return loginFailures;
    },
  };
}

function rowToUser(row) {
  return row
    ? {
        userId: row.user_id,
        email: row.email,
        tenantId: row.tenant_id,
        actorId: row.actor_id,
        roles: row.roles || [],
        status: row.status,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        lastSignInAt: row.last_sign_in_at
          ? row.last_sign_in_at instanceof Date
            ? row.last_sign_in_at.toISOString()
            : row.last_sign_in_at
          : null,
      }
    : null;
}

function rowToCredential(row) {
  return row
    ? {
        credentialId: row.credential_id,
        userId: row.user_id,
        passwordHash: row.password_hash,
        passwordHashVersion: row.password_hash_version,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        lastVerifiedAt: row.last_verified_at
          ? row.last_verified_at instanceof Date
            ? row.last_verified_at.toISOString()
            : row.last_verified_at
          : null,
        forceRehash: !!row.force_rehash,
        revokedAt: row.revoked_at
          ? row.revoked_at instanceof Date
            ? row.revoked_at.toISOString()
            : row.revoked_at
          : null,
      }
    : null;
}

function rowToToken(row) {
  return row
    ? {
        tokenId: row.token_id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        requestedIpHash: row.requested_ip_hash,
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
        consumedAt: row.consumed_at
          ? row.consumed_at instanceof Date
            ? row.consumed_at.toISOString()
            : row.consumed_at
          : null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      }
    : null;
}

function rowToSession(row) {
  return row
    ? {
        sessionId: row.session_id,
        userId: row.user_id,
        sessionHash: row.session_hash,
        csrfHash: row.csrf_hash,
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
        revokedAt: row.revoked_at
          ? row.revoked_at instanceof Date
            ? row.revoked_at.toISOString()
            : row.revoked_at
          : null,
      }
    : null;
}

function createPostgresRegistrationStore(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  return {
    kind: 'postgres',
    async upsertUser(input) {
      const result = await pool.query(
        `
          INSERT INTO auth_users (user_id, email, tenant_id, actor_id, roles, status)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (email) DO UPDATE
          SET tenant_id = EXCLUDED.tenant_id,
              actor_id = EXCLUDED.actor_id,
              roles = EXCLUDED.roles,
              status = EXCLUDED.status,
              updated_at = NOW()
          RETURNING *
        `,
        [
          input.userId || crypto.randomUUID(),
          normalizeEmail(input.email),
          input.tenantId,
          input.actorId,
          normalizeRoles(input.roles),
          normalizeStatus(input.status),
        ]
      );
      return rowToUser(result.rows[0]);
    },
    async listUsers() {
      const result = await pool.query('SELECT * FROM auth_users ORDER BY email ASC');
      return result.rows.map(rowToUser);
    },
    async countUsers() {
      const result = await pool.query('SELECT COUNT(*)::int AS count FROM auth_users');
      return Number(result.rows[0]?.count || 0);
    },
    async findUserByEmail(email) {
      const result = await pool.query('SELECT * FROM auth_users WHERE email = $1', [normalizeEmail(email)]);
      return rowToUser(result.rows[0]);
    },
    async findUserById(userId) {
      const result = await pool.query('SELECT * FROM auth_users WHERE user_id = $1', [userId]);
      return rowToUser(result.rows[0]);
    },
    async setUserStatus(userId, status) {
      const result = await pool.query(
        'UPDATE auth_users SET status = $2, updated_at = NOW() WHERE user_id = $1 RETURNING *',
        [userId, normalizeStatus(status)]
      );
      return rowToUser(result.rows[0]);
    },
    async upsertCredential(input) {
      const result = await pool.query(
        `
          INSERT INTO auth_credentials
            (credential_id, user_id, password_hash, password_hash_version, force_rehash)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (user_id) WHERE revoked_at IS NULL DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              password_hash_version = EXCLUDED.password_hash_version,
              force_rehash = EXCLUDED.force_rehash,
              updated_at = NOW()
          RETURNING *
        `,
        [
          input.credentialId || crypto.randomUUID(),
          input.userId,
          input.passwordHash,
          input.passwordHashVersion || PASSWORD_HASH_VERSION,
          !!input.forceRehash,
        ]
      );
      return rowToCredential(result.rows[0]);
    },
    async findCredentialByUserId(userId) {
      const result = await pool.query(
        'SELECT * FROM auth_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 1',
        [userId]
      );
      return rowToCredential(result.rows[0]);
    },
    async markCredentialVerified(credentialId, at) {
      await pool.query('UPDATE auth_credentials SET last_verified_at = $2, updated_at = NOW() WHERE credential_id = $1', [
        credentialId,
        at,
      ]);
    },
    async createEmailVerificationToken(record) {
      await pool.query(
        `
          INSERT INTO auth_email_verification_tokens
            (token_id, user_id, token_hash, requested_ip_hash, expires_at)
          VALUES ($1,$2,$3,$4,$5)
        `,
        [record.tokenId, record.userId, record.tokenHash, record.requestedIpHash, record.expiresAt]
      );
      return record;
    },
    async findEmailVerificationTokenByHash(tokenHash) {
      const result = await pool.query('SELECT * FROM auth_email_verification_tokens WHERE token_hash = $1', [tokenHash]);
      return rowToToken(result.rows[0]);
    },
    async consumeEmailVerificationToken(tokenId, at) {
      const result = await pool.query(
        `
          UPDATE auth_email_verification_tokens
          SET consumed_at = $2
          WHERE token_id = $1 AND consumed_at IS NULL
          RETURNING *
        `,
        [tokenId, at]
      );
      return rowToToken(result.rows[0]);
    },
    async createPasswordResetToken(record) {
      await pool.query(
        `
          INSERT INTO auth_password_reset_tokens
            (token_id, user_id, token_hash, requested_ip_hash, expires_at)
          VALUES ($1,$2,$3,$4,$5)
        `,
        [record.tokenId, record.userId, record.tokenHash, record.requestedIpHash, record.expiresAt]
      );
      return record;
    },
    async findPasswordResetTokenByHash(tokenHash) {
      const result = await pool.query('SELECT * FROM auth_password_reset_tokens WHERE token_hash = $1', [tokenHash]);
      return rowToToken(result.rows[0]);
    },
    async consumePasswordResetToken(tokenId, at) {
      const result = await pool.query(
        `
          UPDATE auth_password_reset_tokens
          SET consumed_at = $2
          WHERE token_id = $1 AND consumed_at IS NULL
          RETURNING *
        `,
        [tokenId, at]
      );
      return rowToToken(result.rows[0]);
    },
    async createSession(record) {
      await pool.query(
        `
          INSERT INTO auth_sessions (session_id, user_id, session_hash, csrf_hash, expires_at)
          VALUES ($1,$2,$3,$4,$5)
        `,
        [record.sessionId, record.userId, record.sessionHash, record.csrfHash, record.expiresAt]
      );
      return record;
    },
    async findSessionByHash(sessionHash) {
      const result = await pool.query('SELECT * FROM auth_sessions WHERE session_hash = $1', [sessionHash]);
      return rowToSession(result.rows[0]);
    },
    async revokeSession(sessionId, at) {
      await pool.query('UPDATE auth_sessions SET revoked_at = $2 WHERE session_id = $1', [sessionId, at]);
    },
    async revokeUserSessions(userId, at) {
      await pool.query('UPDATE auth_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, at]);
    },
    async touchUserSignIn(userId, at) {
      await pool.query('UPDATE auth_users SET last_sign_in_at = $2, updated_at = NOW() WHERE user_id = $1', [userId, at]);
    },
    async touchSession(sessionId, at) {
      await pool.query('UPDATE auth_sessions SET last_seen_at = $2 WHERE session_id = $1', [sessionId, at]);
    },
    async incrementRateLimit(bucketKey, bucketType, windowMs, limit, at) {
      const windowStart = new Date(at.valueOf() - windowMs);
      const result = await pool.query(
        `
          INSERT INTO auth_rate_limits (bucket_key, bucket_type, count, window_start, updated_at)
          VALUES ($1,$2,1,$3,NOW())
          ON CONFLICT (bucket_key) DO UPDATE
          SET count = CASE
                WHEN auth_rate_limits.window_start < $3 THEN 1
                ELSE auth_rate_limits.count + 1
              END,
              window_start = CASE
                WHEN auth_rate_limits.window_start < $3 THEN NOW()
                ELSE auth_rate_limits.window_start
              END,
              updated_at = NOW()
          RETURNING count
        `,
        [bucketKey, bucketType, windowStart]
      );
      const count = Number(result.rows[0]?.count || 0);
      return { count, limited: count > limit };
    },
    async recordLoginFailure(record) {
      await pool.query(
        `
          INSERT INTO auth_login_failures (failure_id, email_hash, requested_ip_hash, reason)
          VALUES ($1,$2,$3,$4)
        `,
        [
          crypto.randomUUID(),
          record.emailHash || null,
          record.requestedIpHash || null,
          record.reason || 'invalid_credentials',
        ]
      );
    },
    async recordAudit(event) {
      await pool.query(
        `
          INSERT INTO auth_audit_events (event_id, event_type, user_id, actor_id, tenant_id, email_hash, metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        `,
        [
          crypto.randomUUID(),
          event.eventType,
          event.userId || null,
          event.actorId || null,
          event.tenantId || null,
          event.emailHash || null,
          JSON.stringify(event.metadata || {}),
        ]
      );
    },
    async getSecuritySummary() {
      const result = await pool.query(
        `
          SELECT
            (SELECT COUNT(*)::int FROM auth_users) AS users,
            (SELECT COUNT(*)::int FROM auth_credentials WHERE revoked_at IS NULL) AS credentials,
            (SELECT COUNT(*)::int FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > NOW()) AS active_sessions,
            (SELECT COUNT(*)::int FROM auth_rate_limits) AS rate_limit_buckets,
            (SELECT COUNT(*)::int FROM auth_login_failures) AS login_failures,
            (SELECT COUNT(*)::int FROM auth_audit_events) AS audit_events
        `
      );
      return {
        users: Number(result.rows[0]?.users || 0),
        credentials: Number(result.rows[0]?.credentials || 0),
        activeSessions: Number(result.rows[0]?.active_sessions || 0),
        rateLimitBuckets: Number(result.rows[0]?.rate_limit_buckets || 0),
        loginFailures: Number(result.rows[0]?.login_failures || 0),
        auditEvents: Number(result.rows[0]?.audit_events || 0),
      };
    },
  };
}

function createEmailTransport(options = {}) {
  const provider = String(options.provider || process.env.AUTH_EMAIL_PROVIDER || 'test').trim().toLowerCase();
  const sent = [];

  async function sendResendEmail({ to, subject, text }) {
    const resendApiKey = options.resendApiKey || process.env.RESEND_API_KEY;
    const from = options.from || process.env.AUTH_EMAIL_FROM;
    if (!resendApiKey || !from) throw new Error('Resend email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!response.ok) {
      const error = new Error(`Resend email delivery failed with status ${response.status}`);
      error.providerStatus = response.status;
      throw error;
    }
    return { provider, subject };
  }

  async function sendTestEmail(email) {
    sent.push(email);
    return { provider, subject: email.subject };
  }

  return {
    provider,
    sent,
    async sendEmailVerificationEmail({ to, link }) {
      const subject = 'Verify your Engineering Team account';
      const text = [
        'Use this link to verify your Engineering Team account:',
        '',
        link,
        '',
        'This link expires in 24 hours and can be used once.',
        '',
        'If you did not request this email, you can ignore it.',
      ].join('\n');
      const email = { to, subject, text, link, type: 'email_verification' };
      return provider === 'resend' ? sendResendEmail(email) : sendTestEmail(email);
    },
    async sendPasswordResetEmail({ to, link }) {
      const subject = 'Reset your Engineering Team password';
      const text = [
        'Use this link to reset your Engineering Team password:',
        '',
        link,
        '',
        'This link expires in 30 minutes and can be used once.',
        '',
        'If you did not request this email, you can ignore it.',
      ].join('\n');
      const email = { to, subject, text, link, type: 'password_reset' };
      return provider === 'resend' ? sendResendEmail(email) : sendTestEmail(email);
    },
  };
}

function buildRegistrationPolicy(options = {}) {
  const runtimeEnv = options.runtimeEnv || process.env.NODE_ENV || process.env.VERCEL_ENV || 'development';
  const production = runtimeEnv === 'production' || process.env.VERCEL_ENV === 'production';
  const registrationMode = normalizeRegistrationMode(options.registrationMode || process.env.AUTH_REGISTRATION_MODE || 'admin-approved');
  const defaultTenantId = String(options.defaultTenantId || process.env.AUTH_REGISTRATION_DEFAULT_TENANT || 'engineering-team').trim();
  const defaultRoles = normalizeRoles(options.defaultRoles || process.env.AUTH_REGISTRATION_DEFAULT_ROLES || 'reader');
  return {
    production,
    registrationMode,
    defaultTenantId,
    defaultRoles,
    firstAdminEmail: normalizeEmail(options.firstAdminEmail || process.env.AUTH_REGISTRATION_FIRST_ADMIN_EMAIL || ''),
    inviteCode: String(options.inviteCode || process.env.AUTH_REGISTRATION_INVITE_CODE || '').trim(),
    requireEmailVerification: parseBoolean(
      options.requireEmailVerification ?? process.env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      production
    ),
    sessionTtlHours: Number(options.sessionTtlHours || process.env.AUTH_SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS),
    emailVerificationTtlHours: Number(
      options.emailVerificationTtlHours ||
        process.env.AUTH_EMAIL_VERIFICATION_TTL_HOURS ||
        DEFAULT_EMAIL_VERIFICATION_TTL_HOURS
    ),
    passwordResetTtlMinutes: Number(
      options.passwordResetTtlMinutes || process.env.AUTH_PASSWORD_RESET_TTL_MINUTES || DEFAULT_PASSWORD_RESET_TTL_MINUTES
    ),
  };
}

function createRegistrationAuthService(options = {}) {
  const store =
    options.store || (options.pool || options.connectionString ? createPostgresRegistrationStore(options) : createMemoryRegistrationStore());
  const emailTransport = options.emailTransport || createEmailTransport(options);
  const policy = buildRegistrationPolicy(options);
  const sessionSecret = options.sessionSecret || process.env.AUTH_SESSION_SECRET || process.env.AUTH_JWT_SECRET || 'local-test-auth-secret';
  const secureCookies = policy.production;

  function hashSecret(value) {
    return sha256(value, sessionSecret);
  }

  async function recordAudit(eventType, context = {}) {
    await store
      .recordAudit({
        eventType,
        userId: context.userId,
        actorId: context.actorId,
        tenantId: context.tenantId,
        emailHash: context.email ? hashSecret(normalizeEmail(context.email)) : undefined,
        metadata: context.metadata || {},
      })
      .catch(() => {});
  }

  async function rateLimit(bucketPrefix, bucketType, identity, windowMs, limit, at) {
    return store.incrementRateLimit(`${bucketPrefix}:${hashSecret(identity || 'unknown')}`, bucketType, windowMs, limit, at);
  }

  async function createSessionForUser(user, at) {
    const sessionToken = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(at.valueOf() + policy.sessionTtlHours * 60 * 60 * 1000).toISOString();
    await store.createSession({
      sessionId: crypto.randomUUID(),
      userId: user.userId,
      sessionHash: hashSecret(sessionToken),
      csrfHash: hashSecret(csrfToken),
      expiresAt,
    });
    await store.touchUserSignIn(user.userId, at);
    await recordAudit('auth.session.created', {
      userId: user.userId,
      actorId: user.actorId,
      tenantId: user.tenantId,
      email: user.email,
    });
    return { sessionToken, csrfToken, expiresAt };
  }

  async function sendVerificationEmail(user, { ip = '', nowMs = Date.now() } = {}) {
    const at = nowDate(nowMs);
    const token = randomToken(32);
    const expiresAt = new Date(at.valueOf() + policy.emailVerificationTtlHours * 60 * 60 * 1000).toISOString();
    await store.createEmailVerificationToken({
      tokenId: crypto.randomUUID(),
      userId: user.userId,
      tokenHash: hashSecret(token),
      requestedIpHash: ip ? hashSecret(ip) : null,
      expiresAt,
    });
    const publicAppUrl = buildPublicAppUrl(options);
    if (!publicAppUrl) throw new Error('AUTH_PUBLIC_APP_URL is required for email verification delivery');
    const link = `${publicAppUrl}/auth/email/verify?token=${encodeURIComponent(token)}`;
    await emailTransport.sendEmailVerificationEmail({ to: user.email, link });
    await recordAudit('auth.email_verification.sent', {
      userId: user.userId,
      actorId: user.actorId,
      tenantId: user.tenantId,
      email: user.email,
    });
    return { expiresAt };
  }

  async function sendPasswordResetEmail(user, { ip = '', nowMs = Date.now() } = {}) {
    const at = nowDate(nowMs);
    const token = randomToken(32);
    const expiresAt = new Date(at.valueOf() + policy.passwordResetTtlMinutes * 60 * 1000).toISOString();
    await store.createPasswordResetToken({
      tokenId: crypto.randomUUID(),
      userId: user.userId,
      tokenHash: hashSecret(token),
      requestedIpHash: ip ? hashSecret(ip) : null,
      expiresAt,
    });
    const publicAppUrl = buildPublicAppUrl(options);
    if (!publicAppUrl) throw new Error('AUTH_PUBLIC_APP_URL is required for password reset delivery');
    const link = `${publicAppUrl}/auth/password-reset?token=${encodeURIComponent(token)}`;
    await emailTransport.sendPasswordResetEmail({ to: user.email, link });
    await recordAudit('auth.password_reset.sent', {
      userId: user.userId,
      actorId: user.actorId,
      tenantId: user.tenantId,
      email: user.email,
    });
    return { expiresAt };
  }

  return {
    store,
    emailTransport,
    policy,
    normalizeEmail,
    sanitizeNextPath,
    async register({ email, password, displayName = '', inviteCode = '', ip = '', nowMs = Date.now() } = {}) {
      if (policy.registrationMode === 'disabled') {
        throw createAuthError(503, 'registration_disabled', 'Registration is not enabled for this deployment.');
      }
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
        throw createAuthError(400, 'invalid_email', 'A valid email address is required.');
      }
      const at = nowDate(nowMs);
      const emailDomain = normalizedEmail.split('@')[1] || 'unknown';
      const ipLimit = await rateLimit('register-ip', 'registration_ip', ip || 'unknown', 15 * 60 * 1000, 10, at);
      const domainLimit = await rateLimit(
        'register-domain',
        'registration_domain',
        emailDomain,
        15 * 60 * 1000,
        25,
        at
      );
      if (ipLimit.limited || domainLimit.limited) {
        await recordAudit('auth.registration.abuse_classified', {
          email: normalizedEmail,
          metadata: {
            mode: policy.registrationMode,
            ipLimited: ipLimit.limited,
            domainLimited: domainLimit.limited,
            domainHash: hashSecret(emailDomain),
          },
        });
        return { ok: true, message: GENERIC_REGISTRATION_MESSAGE };
      }
      validatePasswordPolicy(password);
      await recordAudit('auth.registration.requested', { email: normalizedEmail, metadata: { mode: policy.registrationMode } });

      const existingUser = await store.findUserByEmail(normalizedEmail);
      const existingCredential = existingUser ? await store.findCredentialByUserId(existingUser.userId) : null;
      if (existingUser?.status === 'disabled' || existingCredential) {
        await recordAudit('auth.registration.suppressed', {
          userId: existingUser?.userId,
          actorId: existingUser?.actorId,
          tenantId: existingUser?.tenantId,
          email: normalizedEmail,
        });
        return { ok: true, message: GENERIC_REGISTRATION_MESSAGE };
      }
      if (!existingUser && policy.registrationMode === 'invite-only' && policy.inviteCode && inviteCode !== policy.inviteCode) {
        await recordAudit('auth.registration.invite_required', { email: normalizedEmail });
        return { ok: true, message: GENERIC_REGISTRATION_MESSAGE };
      }
      if (!existingUser && policy.registrationMode === 'invite-only' && !policy.inviteCode) {
        await recordAudit('auth.registration.invite_required', { email: normalizedEmail });
        return { ok: true, message: GENERIC_REGISTRATION_MESSAGE };
      }

      const isFirstAdmin =
        policy.firstAdminEmail && policy.firstAdminEmail === normalizedEmail && (await store.countUsers()) === 0;
      const status = existingUser
        ? existingUser.status
        : policy.registrationMode === 'admin-approved'
          ? 'pending_approval'
          : policy.requireEmailVerification
            ? 'pending_verification'
            : 'active';
      const user =
        existingUser ||
        (await store.upsertUser({
          email: normalizedEmail,
          tenantId: policy.defaultTenantId,
          actorId: actorIdForEmail(normalizedEmail),
          roles: isFirstAdmin ? ['admin', 'pm', 'reader'] : policy.defaultRoles,
          status,
          displayName,
        }));
      const passwordHash = hashPassword(password);
      await store.upsertCredential({
        userId: user.userId,
        passwordHash,
        passwordHashVersion: PASSWORD_HASH_VERSION,
        forceRehash: false,
      });
      await recordAudit('auth.credential.created', {
        userId: user.userId,
        actorId: user.actorId,
        tenantId: user.tenantId,
        email: user.email,
      });
      if (user.status === 'pending_verification') {
        await sendVerificationEmail(user, { ip, nowMs });
      }
      return { ok: true, message: GENERIC_REGISTRATION_MESSAGE, status: user.status };
    },
    async login({ email, password, ip = '', nowMs = Date.now() } = {}) {
      const at = nowDate(nowMs);
      const normalizedEmail = normalizeEmail(email);
      const emailLimit = await rateLimit('login-email', 'login_email', normalizedEmail, 15 * 60 * 1000, 10, at);
      const ipLimit = await rateLimit('login-ip', 'login_ip', ip || 'unknown', 15 * 60 * 1000, 30, at);
      if (emailLimit.limited || ipLimit.limited) {
        await recordAudit('auth.login.throttled', { email: normalizedEmail });
        throw createAuthError(429, 'login_throttled', 'Sign-in is temporarily unavailable. Try again later.');
      }

      const user = normalizedEmail ? await store.findUserByEmail(normalizedEmail) : null;
      const credential = user ? await store.findCredentialByUserId(user.userId) : null;
      const verified = verifyPassword(String(password || ''), credential?.passwordHash || DUMMY_PASSWORD_HASH);
      if (!user || !credential || !verified || user.status === 'disabled') {
        if (typeof store.recordLoginFailure === 'function') {
          await store
            .recordLoginFailure({
              emailHash: normalizedEmail ? hashSecret(normalizedEmail) : null,
              requestedIpHash: ip ? hashSecret(ip) : null,
              reason: 'invalid_credentials',
            })
            .catch(() => {});
        }
        await recordAudit('auth.login.failed', {
          userId: user?.userId,
          actorId: user?.actorId,
          tenantId: user?.tenantId,
          email: normalizedEmail,
          metadata: { reason: 'invalid_credentials' },
        });
        throw createAuthError(401, 'invalid_credentials', GENERIC_LOGIN_FAILURE);
      }
      if (user.status === 'pending_verification') {
        await recordAudit('auth.login.blocked', {
          userId: user.userId,
          actorId: user.actorId,
          tenantId: user.tenantId,
          email: user.email,
          metadata: { reason: 'email_verification_required' },
        });
        throw createAuthError(403, 'email_verification_required', 'Verify your email before signing in.');
      }
      if (user.status === 'pending_approval' || user.status === 'invited') {
        await recordAudit('auth.login.blocked', {
          userId: user.userId,
          actorId: user.actorId,
          tenantId: user.tenantId,
          email: user.email,
          metadata: { reason: user.status },
        });
        throw createAuthError(403, 'account_not_active', 'This account is not active yet.');
      }

      if (credential.forceRehash || needsPasswordRehash(credential.passwordHash)) {
        await store.upsertCredential({
          userId: user.userId,
          passwordHash: hashPassword(password),
          passwordHashVersion: PASSWORD_HASH_VERSION,
          forceRehash: false,
        });
        await recordAudit('auth.credential.rehashed', {
          userId: user.userId,
          actorId: user.actorId,
          tenantId: user.tenantId,
          email: user.email,
        });
      }
      await store.markCredentialVerified(credential.credentialId, at);
      const session = await createSessionForUser(user, at);
      await recordAudit('auth.login.succeeded', {
        userId: user.userId,
        actorId: user.actorId,
        tenantId: user.tenantId,
        email: user.email,
      });
      return { user, ...session };
    },
    async requestEmailVerification({ email, ip = '', nowMs = Date.now() } = {}) {
      const normalizedEmail = normalizeEmail(email);
      const at = nowDate(nowMs);
      const verificationLimit = await rateLimit(
        'verify-email',
        'email_verification',
        normalizedEmail || ip || 'unknown',
        15 * 60 * 1000,
        3,
        at
      );
      if (verificationLimit.limited) {
        await recordAudit('auth.email_verification.throttled', { email: normalizedEmail });
        return { ok: true, message: GENERIC_EMAIL_VERIFICATION_MESSAGE };
      }
      const user = normalizedEmail ? await store.findUserByEmail(normalizedEmail) : null;
      if (user && user.status === 'pending_verification') {
        await sendVerificationEmail(user, { ip, nowMs });
      }
      return { ok: true, message: GENERIC_EMAIL_VERIFICATION_MESSAGE };
    },
    async confirmEmailVerification({ token, nowMs = Date.now() } = {}) {
      const at = nowDate(nowMs);
      const tokenHash = hashSecret(String(token || '').trim());
      const record = tokenHash ? await store.findEmailVerificationTokenByHash(tokenHash) : null;
      if (!record) {
        await recordAudit('auth.email_verification.invalid_rejected');
        throw createAuthError(401, 'invalid_email_verification_token', 'Email verification token is invalid or expired.');
      }
      if (record.consumedAt) {
        await recordAudit('auth.email_verification.replay_rejected', { userId: record.userId });
        throw createAuthError(401, 'replayed_email_verification_token', 'Email verification token was already used.');
      }
      if (Date.parse(record.expiresAt) <= at.valueOf()) {
        await recordAudit('auth.email_verification.expired_rejected', { userId: record.userId });
        throw createAuthError(401, 'expired_email_verification_token', 'Email verification token expired.');
      }
      await store.consumeEmailVerificationToken(record.tokenId, at);
      const user = await store.findUserById(record.userId);
      if (!user || user.status === 'disabled') {
        throw createAuthError(403, 'inactive_verification_user', 'Email verification token is no longer eligible.');
      }
      const updatedUser = user.status === 'pending_verification' ? await store.setUserStatus(user.userId, 'active') : user;
      await recordAudit('auth.email_verification.confirmed', {
        userId: updatedUser.userId,
        actorId: updatedUser.actorId,
        tenantId: updatedUser.tenantId,
        email: updatedUser.email,
      });
      return { ok: true, user: updatedUser };
    },
    async requestPasswordReset({ email, ip = '', nowMs = Date.now() } = {}) {
      const normalizedEmail = normalizeEmail(email);
      const at = nowDate(nowMs);
      const emailLimit = await rateLimit('reset-email', 'password_reset_email', normalizedEmail, 15 * 60 * 1000, 3, at);
      const ipLimit = await rateLimit('reset-ip', 'password_reset_ip', ip || 'unknown', 15 * 60 * 1000, 10, at);
      if (emailLimit.limited || ipLimit.limited) {
        await recordAudit('auth.password_reset.throttled', { email: normalizedEmail });
        return { ok: true, message: GENERIC_PASSWORD_RESET_MESSAGE };
      }
      const user = normalizedEmail ? await store.findUserByEmail(normalizedEmail) : null;
      const credential = user ? await store.findCredentialByUserId(user.userId) : null;
      if (user?.status === 'active' && credential) {
        await sendPasswordResetEmail(user, { ip, nowMs });
      } else {
        await recordAudit('auth.password_reset.suppressed', {
          userId: user?.userId,
          actorId: user?.actorId,
          tenantId: user?.tenantId,
          email: normalizedEmail,
        });
      }
      return { ok: true, message: GENERIC_PASSWORD_RESET_MESSAGE };
    },
    async confirmPasswordReset({ token, password, nowMs = Date.now() } = {}) {
      validatePasswordPolicy(password);
      const at = nowDate(nowMs);
      const tokenHash = hashSecret(String(token || '').trim());
      const record = tokenHash ? await store.findPasswordResetTokenByHash(tokenHash) : null;
      if (!record) {
        await recordAudit('auth.password_reset.invalid_rejected');
        throw createAuthError(401, 'invalid_password_reset_token', 'Password reset token is invalid or expired.');
      }
      if (record.consumedAt) {
        await recordAudit('auth.password_reset.replay_rejected', { userId: record.userId });
        throw createAuthError(401, 'replayed_password_reset_token', 'Password reset token was already used.');
      }
      if (Date.parse(record.expiresAt) <= at.valueOf()) {
        await recordAudit('auth.password_reset.expired_rejected', { userId: record.userId });
        throw createAuthError(401, 'expired_password_reset_token', 'Password reset token expired.');
      }
      await store.consumePasswordResetToken(record.tokenId, at);
      const user = await store.findUserById(record.userId);
      if (!user || user.status !== 'active') {
        throw createAuthError(403, 'inactive_password_reset_user', 'Password reset token is no longer eligible.');
      }
      await store.upsertCredential({
        userId: user.userId,
        passwordHash: hashPassword(password),
        passwordHashVersion: PASSWORD_HASH_VERSION,
        forceRehash: false,
      });
      await store.revokeUserSessions(user.userId, at);
      await recordAudit('auth.password_reset.confirmed', {
        userId: user.userId,
        actorId: user.actorId,
        tenantId: user.tenantId,
        email: user.email,
      });
      return { ok: true };
    },
    async getSessionContext(request, nowMs = Date.now()) {
      const sessionToken = parseCookies(request.headers.cookie || '')[SESSION_COOKIE];
      if (!sessionToken) return null;
      const session = await store.findSessionByHash(hashSecret(sessionToken));
      if (!session || session.revokedAt || Date.parse(session.expiresAt) <= nowMs) return null;
      const user = await store.findUserById(session.userId);
      if (!user || user.status !== 'active') return null;
      if (typeof store.touchSession === 'function') await store.touchSession(session.sessionId, nowDate(nowMs)).catch(() => {});
      return {
        tenantId: user.tenantId,
        actorId: user.actorId,
        roles: normalizeRoles(user.roles),
        authType: 'cookie-session',
        user,
        session,
      };
    },
    async requireCsrf(request, context) {
      if (!context || context.authType !== 'cookie-session' || !isMutatingMethod(request.method)) return;
      const csrfCookie = parseCookies(request.headers.cookie || '')[CSRF_COOKIE] || '';
      const csrfHeader = request.headers['x-csrf-token'] || '';
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader || hashSecret(csrfCookie) !== context.session.csrfHash) {
        throw createAuthError(403, 'csrf_required', 'CSRF token is required for cookie-authenticated mutations.');
      }
    },
    async revokeSession(request) {
      const context = await this.getSessionContext(request);
      if (context?.session?.sessionId) {
        await store.revokeSession(context.session.sessionId, new Date());
        await recordAudit('auth.session.revoked', {
          userId: context.user.userId,
          actorId: context.actorId,
          tenantId: context.tenantId,
        });
      }
    },
    buildSessionCookies(sessionToken, csrfToken, expiresAt) {
      return [
        serializeCookie(SESSION_COOKIE, sessionToken, {
          httpOnly: true,
          secure: secureCookies,
          sameSite: 'Lax',
          expires: new Date(expiresAt),
        }),
        serializeCookie(CSRF_COOKIE, csrfToken, {
          httpOnly: false,
          secure: secureCookies,
          sameSite: 'Lax',
          expires: new Date(expiresAt),
        }),
      ];
    },
    buildClearCookies() {
      return [
        serializeCookie(SESSION_COOKIE, '', { httpOnly: true, secure: secureCookies, sameSite: 'Lax', maxAge: 0 }),
        serializeCookie(CSRF_COOKIE, '', { httpOnly: false, secure: secureCookies, sameSite: 'Lax', maxAge: 0 }),
      ];
    },
    async listUsers() {
      return store.listUsers();
    },
    async upsertUser(input, actorContext) {
      const before = input.email ? await store.findUserByEmail(input.email) : null;
      const user = await store.upsertUser({
        ...input,
        email: normalizeEmail(input.email),
        roles: normalizeRoles(input.roles),
        status: normalizeStatus(input.status || before?.status || 'active'),
      });
      await recordAudit('auth.user.upserted', {
        userId: user.userId,
        actorId: actorContext?.actorId,
        tenantId: actorContext?.tenantId,
        email: user.email,
        metadata: { roles: user.roles, status: user.status },
      });
      if (before && JSON.stringify([...before.roles].sort()) !== JSON.stringify([...user.roles].sort())) {
        await recordAudit('auth.user.roles_changed', {
          userId: user.userId,
          actorId: actorContext?.actorId,
          tenantId: actorContext?.tenantId,
          email: user.email,
          metadata: { from: before.roles, to: user.roles },
        });
      }
      if (before && before.status !== user.status) {
        await recordAudit(user.status === 'disabled' ? 'auth.user.disabled' : 'auth.user.status_changed', {
          userId: user.userId,
          actorId: actorContext?.actorId,
          tenantId: actorContext?.tenantId,
          email: user.email,
          metadata: { from: before.status, to: user.status },
        });
      }
      return user;
    },
    async getSecuritySummary() {
      return store.getSecuritySummary ? store.getSecuritySummary() : {};
    },
  };
}

module.exports = {
  CSRF_COOKIE,
  GENERIC_EMAIL_VERIFICATION_MESSAGE,
  GENERIC_LOGIN_FAILURE,
  GENERIC_PASSWORD_RESET_MESSAGE,
  GENERIC_REGISTRATION_MESSAGE,
  REGISTRATION_MODES,
  SESSION_COOKIE,
  USER_STATUSES,
  createEmailTransport,
  createMemoryRegistrationStore,
  createPostgresRegistrationStore,
  createRegistrationAuthService,
  isMutatingMethod,
  normalizeEmail,
  normalizeRoles,
  parseCookies,
  sanitizeNextPath,
  serializeCookie,
};
