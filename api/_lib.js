// Delad kod för API:t. Filer som börjar med _ blir inte egna endpoints på Vercel.
import crypto from 'node:crypto';

const COOKIE = 'fp_session';
const SESSION_DAYS = 30;

export const CATEGORIES = ['Branschnytt', 'Festivaler', 'Teknik', 'Jobb & casting', 'Tips'];

// ---------- Databas (Upstash Redis via REST, inga npm-paket behövs) ----------

function dbConfig() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

export function dbReady() {
  const { url, token } = dbConfig();
  return Boolean(url && token);
}

async function call(path, body) {
  const { url, token } = dbConfig();
  if (!url || !token) throw new HttpError(503, 'Databasen är inte kopplad än.');
  const r = await fetch(url.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error('Redis-fel: ' + r.status);
  return data;
}

export async function redis(...cmd) {
  const data = await call('', cmd);
  if (data.error) throw new Error('Redis-fel: ' + data.error);
  return data.result;
}

export async function pipeline(cmds) {
  const data = await call('/pipeline', cmds);
  return data.map((d) => {
    if (d.error) throw new Error('Redis-fel: ' + d.error);
    return d.result;
  });
}

// ---------- HTTP-hjälp ----------

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) throw new HttpError(413, 'För mycket data.');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Ogiltig data.');
  }
}

export function queryParam(req, name) {
  return new URL(req.url, 'http://x').searchParams.get(name);
}

// Enkelt skydd mot förfalskade anrop från andra sajter.
export function requireAppHeader(req) {
  if (req.headers['x-fp'] !== '1') throw new HttpError(403, 'Ogiltigt anrop.');
}

export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Något gick fel på servern. Försök igen om en stund.' });
    }
  };
}

// ---------- Koder ----------

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]/g, '');
}

export function hashCode(code) {
  return crypto.createHash('sha256').update('fp-code:' + normalizeCode(code)).digest('hex');
}

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // utan 0/O och 1/I

export function generateCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `FP-${s.slice(0, 4)}-${s.slice(4)}`;
}

// ---------- Sessioner (signerad cookie) ----------

function secret() {
  return process.env.SESSION_SECRET || 'fp-session:' + (process.env.ADMIN_CODE || '');
}

function b64(s) {
  return Buffer.from(s).toString('base64url');
}

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function cookieFlags(req) {
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
  return `Path=/; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`;
}

export function sessionCookie(req, payload) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = sign({ ...payload, exp });
  return `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieFlags(req)}`;
}

export function clearCookie(req) {
  return `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function getSession(req) {
  const s = verify(readCookie(req, COOKIE));
  if (!s) return null;
  if (s.role === 'member') {
    // Spärrade koder loggas ut direkt.
    if (!dbReady()) return null;
    const exists = await redis('HEXISTS', 'codes', s.code);
    if (!exists) return null;
  }
  return s;
}

export async function requireSession(req, role) {
  const s = await getSession(req);
  if (!s) throw new HttpError(401, 'Du behöver logga in.');
  if (role === 'admin' && s.role !== 'admin') throw new HttpError(403, 'Bara admin kan göra det här.');
  return s;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'okänd').split(',')[0].trim();
}
