// AI-versioner av sidorna, sparade i databasen. Används när admin-AI:n körs utan GitHub-nyckel.
// Varje sida har en liten inbyggd koll i <head> som hämtar AI-versionen via /api/me?page=namn.
// En AI-version gäller bara så länge den vanliga sidan är oförändrad: om sidan själv uppdateras
// (en ny deploy med ändrad fil) slutar den gamla AI-versionen gälla, så att den aldrig döljer nyare ändringar.
import crypto from 'node:crypto';
import { redis } from './_lib.js';

export const PAGES = { home: 'index.html', nyheter: 'nyheter/index.html' };
export const PAGE_BY_PATH = { 'index.html': 'home', 'nyheter/index.html': 'nyheter' };

export function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'filmpower.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https');
  return proto + '://' + host;
}

export function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 20);
}

// Den vanliga sidan som den ligger ute just nu.
export function staticPage(req, name) { return fetchStatic(origin(req), name); }

export async function fetchStatic(base, name) {
  const r = await fetch(base + '/' + PAGES[name] + '?original=' + Date.now(), { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Kunde inte hämta ' + PAGES[name] + ' (' + r.status + ').');
  const html = await r.text();
  return { html, hash: hash(html) };
}

// Fingeravtrycket av den vanliga sidan, sparat per deploy så att det bara räknas ut en gång.
async function staticHash(req, name) {
  const key = 'page:static:' + (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'lokal') + ':' + name;
  const cached = await redis('GET', key);
  if (cached) return cached;
  const { hash: h } = await staticPage(req, name);
  await redis('SET', key, h, 'EX', 86400);
  return h;
}

export async function getOverride(name) {
  const raw = await redis('GET', 'page:override:' + name);
  return raw ? JSON.parse(raw) : null;
}

// AI-versionen om den finns och fortfarande gäller, annars null.
export async function activeOverride(req, name) {
  const o = await getOverride(name);
  if (!o) return null;
  return o.baseHash === (await staticHash(req, name)) ? o : null;
}

export async function setOverride(name, value) {
  const prev = await redis('GET', 'page:override:' + name);
  await redis('SET', 'page:hist:' + name, prev || 'null', 'EX', 30 * 86400);
  if (value) await redis('SET', 'page:override:' + name, JSON.stringify(value));
  else await redis('DEL', 'page:override:' + name);
}

// Används av /api/me?page=namn. Svarar 204 (ingen AI-version) eller sidans HTML.
export async function servePage(req, res, name) {
  if (!PAGES[name]) { res.statusCode = 404; return res.end(); }
  let o = null;
  try { o = await activeOverride(req, name); } catch (err) { console.error('AI-sida:', err); }
  // Webbläsaren frågar alltid på nytt. Vercels server får mellanlagra i 10 sekunder, så att det går snabbt för besökare.
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=10');
  if (!o) { res.statusCode = 204; return res.end(); }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(o.html);
}
