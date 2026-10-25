// AI:ns egen databas: listor som AI:n skapar för funktioner den bygger på sidorna,
// t.ex. recensioner, gästbok, anmälningar, omröstningar eller nyhetsbrev. Kräver ingen ny serverkod.
//
//   GET    /api/me?data=namn            hämtar posterna (godkända, admin ser alla)
//   POST   /api/me?data=namn            sparar en ny post (JSON med listans fält)
//   PATCH  /api/me?data=namn&id=...     admin: { approved: true/false }
//   DELETE /api/me?data=namn&id=...     admin: tar bort
import crypto from 'node:crypto';
import { send, readBody, queryParam, requireAppHeader, getSession, HttpError, redis, pipeline, rateLimit, clientIp } from './_lib.js';

export const NAME = /^[a-z0-9][a-z0-9-]{1,30}$/;
const TYPES = ['text', 'longtext', 'number', 'rating', 'email', 'choice', 'boolean'];

export async function getConfig(name) {
  const raw = NAME.test(name) ? await redis('HGET', 'data:cfg', name) : null;
  return raw ? JSON.parse(raw) : null;
}

export async function listConfigs() {
  const flat = await redis('HGETALL', 'data:cfg');
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ name: flat[i], ...JSON.parse(flat[i + 1]) });
  return out;
}

// Kontrollerar en lista som AI:n vill skapa och gör den till en säker inställning.
export function checkConfig(name, def) {
  if (!NAME.test(name)) throw new Error('Listans namn får bara ha a-z, 0-9 och bindestreck (2-31 tecken).');
  const fields = {};
  for (const [key, f] of Object.entries(def.fields || {})) {
    if (!/^[a-z][a-zA-Z0-9_]{0,24}$/.test(key)) throw new Error(`Fältnamnet "${key}" går inte. Använd a-z, siffror och _.`);
    const type = TYPES.includes(f.type) ? f.type : 'text';
    fields[key] = { type, required: Boolean(f.required), ...(type === 'choice' ? { options: (f.options || []).map((o) => String(o).slice(0, 60)).slice(0, 20) } : {}), ...(type === 'text' || type === 'longtext' ? { max: Math.min(Number(f.max) || (type === 'text' ? 120 : 2000), 4000) } : {}) };
  }
  if (!Object.keys(fields).length) throw new Error('Listan behöver minst ett fält.');
  if (Object.keys(fields).length > 15) throw new Error('Högst 15 fält.');
  return {
    fields,
    read: ['public', 'admin'].includes(def.read) ? def.read : 'public',
    write: ['public', 'members', 'admin'].includes(def.write) ? def.write : 'public',
    approve: Boolean(def.approve),
    perHour: Math.min(Math.max(Number(def.perHour) || 5, 1), 50),
  };
}

function validEntry(cfg, body) {
  const out = {};
  for (const [key, f] of Object.entries(cfg.fields)) {
    let v = body[key];
    if (v === undefined || v === null || v === '') {
      if (f.required) throw new HttpError(400, `Fyll i ${key}.`);
      continue;
    }
    if (f.type === 'number' || f.type === 'rating') {
      v = Number(v);
      if (!Number.isFinite(v)) throw new HttpError(400, `${key} ska vara ett tal.`);
      if (f.type === 'rating') { v = Math.round(v); if (v < 1 || v > 5) throw new HttpError(400, `${key} ska vara 1 till 5.`); }
    } else if (f.type === 'boolean') v = Boolean(v);
    else if (f.type === 'email') {
      v = String(v).trim().slice(0, 120);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, `${key} ska vara en e-postadress.`);
    } else if (f.type === 'choice') {
      v = String(v);
      if (!f.options.includes(v)) throw new HttpError(400, `Ogiltigt val för ${key}.`);
    } else v = String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, f.max || 120);
    out[key] = v;
  }
  return out;
}

// Snittvärden och antal för tal- och betygsfält, så att sidan kan visa t.ex. snittbetyg.
function summary(cfg, items) {
  const s = { count: items.length };
  for (const [key, f] of Object.entries(cfg.fields)) {
    if (f.type !== 'number' && f.type !== 'rating') continue;
    const vals = items.map((i) => i[key]).filter((v) => typeof v === 'number');
    if (vals.length) s[key + 'Average'] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  for (const [key, f] of Object.entries(cfg.fields)) {
    if (f.type !== 'choice') continue;
    s[key + 'Counts'] = Object.fromEntries(f.options.map((o) => [o, items.filter((i) => i[key] === o).length]));
  }
  return s;
}

export async function entries(name, all) {
  const ids = await redis('ZREVRANGE', 'data:' + name + ':idx', 0, 299);
  const raws = ids.length ? await redis('HMGET', 'data:' + name, ...ids) : [];
  const items = raws.filter(Boolean).map((r) => JSON.parse(r));
  return all ? items : items.filter((i) => i.approved !== false);
}

export async function dataHandler(req, res) {
  const name = String(queryParam(req, 'data') || '');
  const cfg = await getConfig(name);
  if (!cfg) throw new HttpError(404, 'Listan finns inte.');
  const s = await getSession(req);
  const admin = Boolean(s && s.role === 'admin');

  if (req.method === 'GET') {
    if (cfg.read === 'admin' && !admin) throw new HttpError(403, 'Bara admin kan se den här listan.');
    const items = await entries(name, admin);
    const visible = admin ? items : items.map((i) => { const o = { ...i }; for (const [k, f] of Object.entries(cfg.fields)) if (f.type === 'email') delete o[k]; return o; });
    return send(res, 200, { items: visible.slice(0, 100), summary: summary(cfg, items.filter((i) => i.approved !== false)), admin, fields: cfg.fields });
  }

  requireAppHeader(req);
  const id = String(queryParam(req, 'id') || '');
  if (req.method === 'DELETE' || req.method === 'PATCH') {
    if (!admin) throw new HttpError(403, 'Bara admin kan göra det.');
    const raw = await redis('HGET', 'data:' + name, id);
    if (!raw) throw new HttpError(404, 'Posten finns inte.');
    if (req.method === 'DELETE') await pipeline([['HDEL', 'data:' + name, id], ['ZREM', 'data:' + name + ':idx', id]]);
    else { const b = await readBody(req, 2000); await redis('HSET', 'data:' + name, id, JSON.stringify({ ...JSON.parse(raw), approved: Boolean(b.approved) })); }
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Metoden stöds inte.');
  if (cfg.write === 'admin' && !admin) throw new HttpError(403, 'Bara admin kan lägga till här.');
  if (cfg.write === 'members' && !(s && !s.guest)) throw new HttpError(401, 'Logga in först.');
  const body = await readBody(req, 12_000);
  if (body.website) return send(res, 200, { ok: true });
  const item = validEntry(cfg, body);
  if (!admin) await rateLimit('rl:data:' + name + ':' + clientIp(req), cfg.perHour, 3600, 'Du har skickat många gånger nyss. Försök igen om en stund.');
  const count = await redis('ZCARD', 'data:' + name + ':idx');
  if (count >= 5000) throw new HttpError(507, 'Listan är full.');
  const entry = { id: crypto.randomBytes(6).toString('hex'), ...item, createdAt: Date.now(), ...(cfg.approve && !admin ? { approved: false } : {}) };
  await pipeline([['HSET', 'data:' + name, entry.id, JSON.stringify(entry)], ['ZADD', 'data:' + name + ':idx', entry.createdAt, entry.id]]);
  return send(res, 200, { ok: true, pending: entry.approved === false, item: entry });
}
