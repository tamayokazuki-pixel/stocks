import crypto from 'node:crypto';
import { db } from './db.js';

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

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + SESSION_AGE_MS, Date.now());
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

export function destroySession(req, res) {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

export function getUser(req) {
  const token = sessionToken(req);
  if (!token || token.length > 128) return null;
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
