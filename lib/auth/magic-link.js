const crypto = require('crypto');
const { ROLE_PERMISSIONS } = require('../audit/authz');
const { createPgPoolFromEnv } = require('../audit/postgres');

const SESSION_COOKIE = 'engineering_team_session';
const CSRF_COOKIE = 'engineering_team_csrf';
const DEFAULT_NEXT = '/tasks';
const DEFAULT_MAGIC_LINK_TTL_MINUTES = 15;
const DEFAULT_SESSION_TTL_HOURS = 8;

function nowDate(nowMs = Date.now()) {
  return new Date(nowMs);
}

function sha256(value, secret = '') {
  return crypto.createHash('sha256').update(`${secret}:${value}`).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeRoles(roles = []) {
  const available = new Set(Object.keys(ROLE_PERMISSIONS));
  const normalized = Array.isArray(roles) ? roles : String(roles || '').split(',');
  const result = [...new Set(normalized.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean))];
  const invalid = result.filter((role) => !available.has(role));
  if (invalid.length) {
    const error = new Error(`Invalid auth roles: ${invalid.join(', ')}`);
    error.statusCode = 400;
    error.code = 'invalid_auth_roles';
    throw error;
  }
  return result;
}

function sanitizeNextPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || !trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_NEXT;
  const withoutHash = trimmed.split('#')[0];
  if (!withoutHash || withoutHash.startsWith('/sign-in') || withoutHash.startsWith('/auth/magic-link')) return DEFAULT_NEXT;
  return withoutHash;
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
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

function buildPublicAppUrl(options = {}) {
  return String(options.publicAppUrl || process.env.AUTH_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

function createMemoryAuthStore() {
  const users = new Map();
  const links = new Map();
  const sessions = new Map();
  const limits = new Map();
  const auditEvents = [];

  return {
    kind: 'memory',
    async upsertUser(input) {
      const email = normalizeEmail(input.email);
      const existing = [...users.values()].find((user) => user.email === email);
      const next = {
        userId: existing?.userId || crypto.randomUUID(),
        email,
        tenantId: String(input.tenantId || existing?.tenantId || '').trim(),
        actorId: String(input.actorId || existing?.actorId || '').trim(),
        roles: normalizeRoles(input.roles ?? existing?.roles ?? []),
        status: String(input.status || existing?.status || 'active').trim().toLowerCase(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSignInAt: existing?.lastSignInAt || null,
      };
      users.set(next.userId, next);
      return next;
    },
    async listUsers() {
      return [...users.values()].sort((a, b) => a.email.localeCompare(b.email));
    },
    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === normalizeEmail(email)) || null;
    },
    async findUserById(userId) {
      return users.get(userId) || null;
    },
    async createMagicLink(record) {
      links.set(record.linkId, record);
      return record;
    },
    async findMagicLinkByHash(tokenHash) {
      return [...links.values()].find((link) => link.tokenHash === tokenHash) || null;
    },
    async consumeMagicLink(linkId, consumedAt) {
      const link = links.get(linkId);
      if (!link || link.consumedAt) return null;
      link.consumedAt = consumedAt.toISOString();
      return link;
    },
    async createSession(record) {
      sessions.set(record.sessionId, record);
      return record;
    },
    async findSessionByHash(sessionHash) {
      return [...sessions.values()].find((session) => session.sessionHash === sessionHash) || null;
    },
    async revokeSession(sessionId, revokedAt) {
      const session = sessions.get(sessionId);
      if (session) session.revokedAt = revokedAt.toISOString();
    },
    async touchUserSignIn(userId, signedInAt) {
      const user = users.get(userId);
      if (user) user.lastSignInAt = signedInAt.toISOString();
    },
    async touchSession(sessionId, seenAt) {
      const session = sessions.get(sessionId);
      if (session) session.lastSeenAt = seenAt.toISOString();
    },
    async incrementRateLimit(bucketKey, bucketType, windowMs, limit, at) {
      const current = limits.get(bucketKey);
      if (!current || at.valueOf() - Date.parse(current.windowStart) >= windowMs) {
        limits.set(bucketKey, { bucketKey, bucketType, count: 1, windowStart: at.toISOString() });
        return { count: 1, limited: false };
      }
      current.count += 1;
      return { count: current.count, limited: current.count > limit };
    },
    async recordAudit(event) {
      auditEvents.push({ ...event, eventId: crypto.randomUUID(), createdAt: new Date().toISOString() });
    },
    get auditEvents() {
      return auditEvents;
    },
  };
}

function rowToUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    roles: row.roles || [],
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    lastSignInAt: row.last_sign_in_at ? (row.last_sign_in_at instanceof Date ? row.last_sign_in_at.toISOString() : row.last_sign_in_at) : null,
  };
}

function createPostgresAuthStore(options = {}) {
  const pool = options.pool || createPgPoolFromEnv(options.connectionString);
  return {
    kind: 'postgres',
    async upsertUser(input) {
      const result = await pool.query(`
        INSERT INTO auth_users (user_id, email, tenant_id, actor_id, roles, status)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (email) DO UPDATE
        SET tenant_id = EXCLUDED.tenant_id,
            actor_id = EXCLUDED.actor_id,
            roles = EXCLUDED.roles,
            status = EXCLUDED.status,
            updated_at = NOW()
        RETURNING *
      `, [input.userId || crypto.randomUUID(), normalizeEmail(input.email), input.tenantId, input.actorId, normalizeRoles(input.roles), input.status || 'active']);
      return rowToUser(result.rows[0]);
    },
    async listUsers() {
      const result = await pool.query('SELECT * FROM auth_users ORDER BY email ASC');
      return result.rows.map(rowToUser);
    },
    async findUserByEmail(email) {
      const result = await pool.query('SELECT * FROM auth_users WHERE email = $1', [normalizeEmail(email)]);
      return rowToUser(result.rows[0]);
    },
    async findUserById(userId) {
      const result = await pool.query('SELECT * FROM auth_users WHERE user_id = $1', [userId]);
      return rowToUser(result.rows[0]);
    },
    async createMagicLink(record) {
      await pool.query(`
        INSERT INTO auth_magic_links (link_id, user_id, token_hash, next_path, requested_ip_hash, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [record.linkId, record.userId, record.tokenHash, record.nextPath, record.requestedIpHash, record.expiresAt]);
      return record;
    },
    async findMagicLinkByHash(tokenHash) {
      const result = await pool.query('SELECT * FROM auth_magic_links WHERE token_hash = $1', [tokenHash]);
      const row = result.rows[0];
      return row ? {
        linkId: row.link_id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        nextPath: row.next_path,
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
        consumedAt: row.consumed_at ? (row.consumed_at instanceof Date ? row.consumed_at.toISOString() : row.consumed_at) : null,
      } : null;
    },
    async consumeMagicLink(linkId, consumedAt) {
      const result = await pool.query(`
        UPDATE auth_magic_links
        SET consumed_at = $2
        WHERE link_id = $1 AND consumed_at IS NULL
        RETURNING *
      `, [linkId, consumedAt]);
      return result.rows[0] || null;
    },
    async createSession(record) {
      await pool.query(`
        INSERT INTO auth_sessions (session_id, user_id, session_hash, csrf_hash, expires_at)
        VALUES ($1,$2,$3,$4,$5)
      `, [record.sessionId, record.userId, record.sessionHash, record.csrfHash, record.expiresAt]);
      return record;
    },
    async findSessionByHash(sessionHash) {
      const result = await pool.query('SELECT * FROM auth_sessions WHERE session_hash = $1', [sessionHash]);
      const row = result.rows[0];
      return row ? {
        sessionId: row.session_id,
        userId: row.user_id,
        sessionHash: row.session_hash,
        csrfHash: row.csrf_hash,
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
        revokedAt: row.revoked_at ? (row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at) : null,
      } : null;
    },
    async revokeSession(sessionId, revokedAt) {
      await pool.query('UPDATE auth_sessions SET revoked_at = $2 WHERE session_id = $1', [sessionId, revokedAt]);
    },
    async touchUserSignIn(userId, signedInAt) {
      await pool.query('UPDATE auth_users SET last_sign_in_at = $2, updated_at = NOW() WHERE user_id = $1', [userId, signedInAt]);
    },
    async touchSession(sessionId, seenAt) {
      await pool.query('UPDATE auth_sessions SET last_seen_at = $2 WHERE session_id = $1', [seenAt, sessionId]);
    },
    async incrementRateLimit(bucketKey, bucketType, windowMs, limit, at) {
      const windowStart = new Date(at.valueOf() - windowMs);
      const result = await pool.query(`
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
      `, [bucketKey, bucketType, windowStart]);
      const count = Number(result.rows[0]?.count || 0);
      return { count, limited: count > limit };
    },
    async recordAudit(event) {
      await pool.query(`
        INSERT INTO auth_audit_events (event_id, event_type, user_id, actor_id, tenant_id, email_hash, metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      `, [crypto.randomUUID(), event.eventType, event.userId || null, event.actorId || null, event.tenantId || null, event.emailHash || null, JSON.stringify(event.metadata || {})]);
    },
  };
}

function createEmailTransport(options = {}) {
  const provider = String(options.provider || process.env.AUTH_EMAIL_PROVIDER || 'test').trim().toLowerCase();
  const sent = [];
  return {
    provider,
    sent,
    async sendMagicLinkEmail({ to, link }) {
      const subject = 'Sign in to Engineering Team';
      const text = `Use this link to sign in to Engineering Team:\n\n${link}\n\nThis link expires in 15 minutes and can be used once.\n\nIf you did not request this email, you can ignore it.`;
      if (provider === 'resend') {
        const apiKey = options.resendApiKey || process.env.RESEND_API_KEY;
        const from = options.from || process.env.AUTH_EMAIL_FROM;
        if (!apiKey || !from) throw new Error('Resend email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM');
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to, subject, text }),
        });
        if (!response.ok) {
          const error = new Error(`Resend email delivery failed with status ${response.status}`);
          error.providerStatus = response.status;
          error.provider = provider;
          throw error;
        }
        return { provider, subject };
      }
      sent.push({ to, subject, text, link });
      return { provider, subject };
    },
  };
}

function createMagicLinkAuthService(options = {}) {
  const store = options.store || (options.pool || options.connectionString ? createPostgresAuthStore(options) : createMemoryAuthStore());
  const emailTransport = options.emailTransport || createEmailTransport(options);
  const secret = options.sessionSecret || process.env.AUTH_SESSION_SECRET || process.env.AUTH_JWT_SECRET || 'local-test-auth-secret';
  const ttlMinutes = Number(options.magicLinkTtlMinutes || process.env.AUTH_MAGIC_LINK_TTL_MINUTES || DEFAULT_MAGIC_LINK_TTL_MINUTES);
  const sessionTtlHours = Number(options.sessionTtlHours || process.env.AUTH_SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS);
  const isProduction = options.runtimeEnv === 'production' || process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  function hashToken(token) {
    return sha256(token, secret);
  }

  async function audit(eventType, data = {}) {
    await store.recordAudit({
      eventType,
      userId: data.userId,
      actorId: data.actorId,
      tenantId: data.tenantId,
      emailHash: data.email ? sha256(normalizeEmail(data.email), secret) : undefined,
      metadata: data.metadata || {},
    }).catch(() => {});
  }

  async function checkRateLimits(email, ip, at) {
    const windowMs = 15 * 60 * 1000;
    const emailLimit = await store.incrementRateLimit(`email:${sha256(normalizeEmail(email), secret)}`, 'email', windowMs, 3, at);
    const ipLimit = await store.incrementRateLimit(`ip:${sha256(ip || 'unknown', secret)}`, 'ip', windowMs, 10, at);
    return emailLimit.limited || ipLimit.limited;
  }

  return {
    store,
    emailTransport,
    normalizeEmail,
    sanitizeNextPath,
    async requestMagicLink({ email, next, ip = '', nowMs = Date.now() }) {
      const normalizedEmail = normalizeEmail(email);
      const at = nowDate(nowMs);
      const generic = { ok: true, message: 'If the email is eligible, a sign-in link has been sent.' };
      if (!normalizedEmail) return generic;
      await audit('auth.magic_link.requested', { email: normalizedEmail, metadata: { next: sanitizeNextPath(next) } });
      const limited = await checkRateLimits(normalizedEmail, ip, at);
      if (limited) {
        await audit('auth.magic_link.request_throttled', { email: normalizedEmail });
        return generic;
      }
      const user = await store.findUserByEmail(normalizedEmail);
      if (!user || user.status !== 'active') {
        await audit('auth.magic_link.request_suppressed', { email: normalizedEmail });
        return generic;
      }
      const token = randomToken(32);
      const expiresAt = new Date(at.valueOf() + ttlMinutes * 60 * 1000).toISOString();
      const nextPath = sanitizeNextPath(next);
      await store.createMagicLink({
        linkId: crypto.randomUUID(),
        userId: user.userId,
        tokenHash: hashToken(token),
        nextPath,
        requestedIpHash: ip ? sha256(ip, secret) : null,
        expiresAt,
      });
      const publicAppUrl = buildPublicAppUrl(options);
      if (!publicAppUrl) throw new Error('AUTH_PUBLIC_APP_URL is required for magic-link email delivery');
      const link = `${publicAppUrl}/auth/magic-link/consume?token=${encodeURIComponent(token)}&next=${encodeURIComponent(nextPath)}`;
      try {
        await emailTransport.sendMagicLinkEmail({ to: normalizedEmail, link });
        await audit('auth.magic_link.sent', { userId: user.userId, actorId: user.actorId, tenantId: user.tenantId, email: normalizedEmail });
      } catch (error) {
        await audit('auth.magic_link.delivery_failed', {
          userId: user.userId,
          actorId: user.actorId,
          tenantId: user.tenantId,
          email: normalizedEmail,
          metadata: {
            provider: emailTransport.provider || error.provider || 'unknown',
            reason: 'delivery_failed',
            providerStatus: Number.isInteger(error.providerStatus) ? error.providerStatus : null,
          },
        });
      }
      return generic;
    },
    async consumeMagicLink({ token, next, nowMs = Date.now() }) {
      const at = nowDate(nowMs);
      const tokenHash = hashToken(String(token || '').trim());
      const link = tokenHash ? await store.findMagicLinkByHash(tokenHash) : null;
      if (!link) {
        await audit('auth.magic_link.invalid_rejected');
        const error = new Error('The sign-in link is invalid or expired.');
        error.statusCode = 401;
        error.code = 'invalid_magic_link';
        throw error;
      }
      if (link.consumedAt) {
        await audit('auth.magic_link.replay_rejected', { userId: link.userId });
        const error = new Error('The sign-in link has already been used.');
        error.statusCode = 401;
        error.code = 'replayed_magic_link';
        throw error;
      }
      if (Date.parse(link.expiresAt) <= at.valueOf()) {
        await audit('auth.magic_link.expired_rejected', { userId: link.userId });
        const error = new Error('The sign-in link expired. Request a new link.');
        error.statusCode = 401;
        error.code = 'expired_magic_link';
        throw error;
      }
      const consumed = await store.consumeMagicLink(link.linkId, at);
      if (!consumed) {
        const error = new Error('The sign-in link has already been used.');
        error.statusCode = 401;
        error.code = 'replayed_magic_link';
        throw error;
      }
      const user = await store.findUserById(link.userId);
      if (!user || user.status !== 'active') {
        const error = new Error('The sign-in link is no longer eligible.');
        error.statusCode = 403;
        error.code = 'inactive_magic_link_user';
        throw error;
      }
      const sessionToken = randomToken(32);
      const csrfToken = randomToken(24);
      const expiresAt = new Date(at.valueOf() + sessionTtlHours * 60 * 60 * 1000).toISOString();
      await store.createSession({
        sessionId: crypto.randomUUID(),
        userId: user.userId,
        sessionHash: hashToken(sessionToken),
        csrfHash: hashToken(csrfToken),
        expiresAt,
      });
      await store.touchUserSignIn(user.userId, at);
      await audit('auth.magic_link.consumed', { userId: user.userId, actorId: user.actorId, tenantId: user.tenantId, email: user.email });
      await audit('auth.session.created', { userId: user.userId, actorId: user.actorId, tenantId: user.tenantId, email: user.email });
      return { user, sessionToken, csrfToken, expiresAt, next: sanitizeNextPath(next || link.nextPath) };
    },
    async getSessionContext(req, nowMs = Date.now()) {
      const cookies = parseCookies(req.headers.cookie || '');
      const sessionToken = cookies[SESSION_COOKIE];
      if (!sessionToken) return null;
      const session = await store.findSessionByHash(hashToken(sessionToken));
      if (!session || session.revokedAt || Date.parse(session.expiresAt) <= nowMs) return null;
      const user = await store.findUserById(session.userId);
      if (!user || user.status !== 'active') return null;
      if (typeof store.touchSession === 'function') {
        await store.touchSession(session.sessionId, nowDate(nowMs)).catch(() => {});
      }
      return {
        tenantId: user.tenantId,
        actorId: user.actorId,
        roles: normalizeRoles(user.roles),
        authType: 'cookie-session',
        user,
        session,
      };
    },
    async requireCsrf(req, context) {
      if (!context || context.authType !== 'cookie-session' || !isMutatingMethod(req.method)) return;
      const cookies = parseCookies(req.headers.cookie || '');
      const cookieToken = cookies[CSRF_COOKIE] || '';
      const headerToken = req.headers['x-csrf-token'] || '';
      if (!cookieToken || !headerToken || cookieToken !== headerToken || hashToken(cookieToken) !== context.session.csrfHash) {
        const error = new Error('CSRF token is required for cookie-authenticated mutations.');
        error.statusCode = 403;
        error.code = 'csrf_required';
        throw error;
      }
    },
    async revokeSession(req) {
      const context = await this.getSessionContext(req);
      if (context?.session?.sessionId) {
        await store.revokeSession(context.session.sessionId, new Date());
        await audit('auth.session.revoked', { userId: context.user.userId, actorId: context.actorId, tenantId: context.tenantId });
      }
    },
    buildSessionCookies(sessionToken, csrfToken, expiresAt) {
      return [
        serializeCookie(SESSION_COOKIE, sessionToken, { httpOnly: true, secure: isProduction, sameSite: 'Lax', expires: new Date(expiresAt) }),
        serializeCookie(CSRF_COOKIE, csrfToken, { httpOnly: false, secure: isProduction, sameSite: 'Lax', expires: new Date(expiresAt) }),
      ];
    },
    buildClearCookies() {
      return [
        serializeCookie(SESSION_COOKIE, '', { httpOnly: true, secure: isProduction, sameSite: 'Lax', maxAge: 0 }),
        serializeCookie(CSRF_COOKIE, '', { httpOnly: false, secure: isProduction, sameSite: 'Lax', maxAge: 0 }),
      ];
    },
    async listUsers() {
      return store.listUsers();
    },
    async upsertUser(input, actor) {
      const roles = normalizeRoles(input.roles);
      const existing = normalizeEmail(input.email) ? await store.findUserByEmail(input.email) : null;
      const user = await store.upsertUser({ ...input, roles, email: normalizeEmail(input.email), status: input.status || 'active' });
      await audit('auth.user.upserted', { userId: user.userId, actorId: actor?.actorId, tenantId: actor?.tenantId, email: user.email, metadata: { roles, status: user.status } });
      const previousRoles = existing?.roles || [];
      if (existing && JSON.stringify([...previousRoles].sort()) !== JSON.stringify([...roles].sort())) {
        await audit('auth.user.roles_changed', {
          userId: user.userId,
          actorId: actor?.actorId,
          tenantId: actor?.tenantId,
          email: user.email,
          metadata: { from: previousRoles, to: roles },
        });
      }
      if (existing && existing.status !== user.status) {
        await audit(user.status === 'disabled' ? 'auth.user.disabled' : 'auth.user.reactivated', {
          userId: user.userId,
          actorId: actor?.actorId,
          tenantId: actor?.tenantId,
          email: user.email,
          metadata: { from: existing.status, to: user.status },
        });
      }
      return user;
    },
  };
}

module.exports = {
  CSRF_COOKIE,
  SESSION_COOKIE,
  createEmailTransport,
  createMagicLinkAuthService,
  createMemoryAuthStore,
  createPostgresAuthStore,
  isMutatingMethod,
  normalizeEmail,
  normalizeRoles,
  parseCookies,
  sanitizeNextPath,
  serializeCookie,
};
