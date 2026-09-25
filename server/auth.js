import crypto from 'node:crypto';
import { db } from './db.js';

const COOKIE_NAME = 'northstar_session';
// Lax cookies are dropped by browsers whenever the app is loaded in a cross-site context (for
// example a preview/embed iframe), which silently signs people out right after they authenticate.
// A second cookie holding the same token is issued with SameSite=None; Secure; Partitioned so the
// session survives there. Browsers ignore it over plain HTTP, where the Lax cookie is used instead.
const CROSS_SITE_COOKIE_NAME = 'northstar_session_xs';
const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 128;

function cookieValue(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  const cookie = cookies.find(part => part.trim().startsWith(`${name}=`));
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.trim().slice(name.length + 1)); }
  catch { return null; }
}

// Browsers that block all third-party storage never send either cookie back. The client detects
// that case after signing in and falls back to sending the same token as a bearer credential.
function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

function sessionToken(req) {
  return bearerToken(req) || cookieValue(req, COOKIE_NAME) || cookieValue(req, CROSS_SITE_COOKIE_NAME);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Cookie flags follow the actual connection rather than NODE_ENV: a Secure cookie sent over plain
// HTTP is discarded by the browser, and a development server behind an HTTPS proxy still needs it.
function isSecureRequest(req) {
  if (req?.secure) return true;
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwarded === 'https';
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req), path: '/', maxAge: SESSION_AGE_MS };
}

function crossSiteCookieOptions() {
  return { httpOnly: true, sameSite: 'none', secure: true, partitioned: true, path: '/', maxAge: SESSION_AGE_MS };
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + SESSION_AGE_MS, Date.now());
  res.cookie(COOKIE_NAME, token, cookieOptions(req));
  res.cookie(CROSS_SITE_COOKIE_NAME, token, crossSiteCookieOptions());
  return token;
}

export function destroySession(req, res) {
  const token = sessionToken(req);
  if (token && token.length <= MAX_TOKEN_LENGTH) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  const { maxAge: _cookieAge, ...clearOptions } = cookieOptions(req);
  const { maxAge: _crossSiteAge, ...clearCrossSiteOptions } = crossSiteCookieOptions();
  res.clearCookie(COOKIE_NAME, clearOptions);
  res.clearCookie(CROSS_SITE_COOKIE_NAME, clearCrossSiteOptions);
}

export function getUser(req) {
  const token = sessionToken(req);
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const session = db.prepare(`SELECT users.id, users.name, users.email, users.role, users.status, users.cash_cents AS cashCents,
      users.created_at AS createdAt, sessions.expires_at AS expiresAt
    FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token_hash = ?`).get(hashToken(token));
  if (!session) return null;
  if (session.expiresAt <= Date.now() || session.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  const { expiresAt, ...user } = session;
  return user;
}

export function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  req.user = user;
  next();
}
