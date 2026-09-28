import crypto from 'node:crypto';
import { db } from './db.js';

const USER_COLUMNS = `users.id, users.name, users.email, users.role, users.status,\n  users.is_demo AS isDemo, users.cash_cents AS cashCents, users.created_at AS createdAt`;

const COOKIE_NAME = 'northstar_session';
const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sessionToken(req) {
  const cookies = (req.headers.cookie || '').split(';');
  const cookie = cookies.find(part => part.trim().startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.trim().slice(COOKIE_NAME.length + 1)); }
  catch { return null; }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_AGE_MS,
  };
}

// `linkedUserId` records the other side of a real <-> demo switch so the pair stays switchable.
export function createSession(res, userId, linkedUserId = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, linked_user_id, expires_at, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(hashToken(token), userId, linkedUserId, Date.now() + SESSION_AGE_MS, Date.now());
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

// Replaces the current session cookie with one for `targetUserId`, keeping the previous account
// linked so the user can switch straight back.
export function switchSession(req, res, targetUserId) {
  const token = sessionToken(req);
  const current = token ? db.prepare('SELECT user_id AS userId FROM sessions WHERE token_hash = ?').get(hashToken(token)) : null;
  destroySession(req, res);
  createSession(res, targetUserId, current?.userId ?? null);
}

// The account linked to the current session, when it exists and is still usable.
export function linkedUserId(req) {
  const token = sessionToken(req);
  if (!token || token.length > 128) return null;
  const session = db.prepare('SELECT linked_user_id AS linkedUserId FROM sessions WHERE token_hash = ?').get(hashToken(token));
  return session?.linkedUserId ?? null;
}

export function destroySession(req, res) {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

export function getUser(req) {
  const token = sessionToken(req);
  if (!token || token.length > 128) return null;
  const session = db.prepare(`SELECT ${USER_COLUMNS}, sessions.expires_at AS expiresAt
    FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token_hash = ?`).get(hashToken(token));
  if (!session) return null;
  if (session.expiresAt <= Date.now() || session.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  const { expiresAt, ...user } = session;
  return { ...user, isDemo: Boolean(user.isDemo) };
}

export function userById(id) {
  const user = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
  return user ? { ...user, isDemo: Boolean(user.isDemo) } : null;
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
