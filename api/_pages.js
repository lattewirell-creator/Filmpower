// AI-versioner av sidorna, sparade i databasen. Används när admin-AI:n körs utan GitHub-nyckel.
// Varje sida har en liten inbyggd koll i <head> som hämtar AI-versionen via /api/me?page=namn.
// En AI-version gäller bara så länge den vanliga sidan är oförändrad: om sidan själv uppdateras
// (en ny deploy med ändrad fil) slutar den gamla AI-versionen gälla, så att den aldrig döljer nyare ändringar.
import crypto from 'node:crypto';
import { redis } from './_lib.js';

export const PAGES = { home: 'index.html', nyheter: 'nyheter/index.html' };
export const PAGE_BY_PATH = { 'index.html': 'home', 'nyheter/index.html': 'nyheter' };

// Egna sidor som AI:n skapar. De ligger bara i databasen och visas på /sida/namn
// (vercel.json skickar dit /api/me?sida=namn). Filnamnet för AI:n är sidor/namn.html.
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export function nameOfPath(path) {
  if (PAGE_BY_PATH[path]) return PAGE_BY_PATH[path];
  const m = /^sidor\/([a-z0-9-]+)\.html$/.exec(path);
  return m && SLUG.test(m[1]) ? 'sida:' + m[1] : null;
}
export const isCustom = (name) => String(name).startsWith('sida:');

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
  // Bara den riktiga sidan räknas. En inloggningssida eller felsida (t.ex. på en skyddad förhandsadress) får aldrig bli fingeravtrycket.
  if (!html.includes('__fpPage') || !/<\/html>\s*$/i.test(html)) throw new Error('Fick inte den riktiga sidan från ' + base + '.');
  return { html, hash: hash(html) };
}

// Fingeravtrycket av den vanliga sidan, sparat per deploy så att det bara räknas ut en gång.
const deployKey = (name) => (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'lokal') + ':' + name;
async function staticHash(req, name, fresh) {
  const key = 'page:static:' + deployKey(name);
  const cached = fresh ? null : await redis('GET', key);
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
  if (o.baseHash === (await staticHash(req, name))) return o;
  // Stämmer det inte, räkna om fingeravtrycket (högst en gång i minuten), ifall det sparade var fel.
  if (await redis('SET', 'page:recheck:' + deployKey(name), '1', 'NX', 'EX', 60)) {
    if (o.baseHash === (await staticHash(req, name, true))) return o;
  }
  return null;
}

export async function setOverride(name, value) {
  const prev = await redis('GET', 'page:override:' + name);
  await redis('SET', 'page:hist:' + name, prev || 'null', 'EX', 30 * 86400);
  if (value) await redis('SET', 'page:override:' + name, JSON.stringify(value));
  else await redis('DEL', 'page:override:' + name);
  if (isCustom(name)) await redis(value ? 'SADD' : 'SREM', 'pages:custom', name.slice(5));
}

const NOT_FOUND = '<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sidan finns inte</title></head><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;text-align:center"><div><h1>Sidan finns inte</h1><p><a href="/">Till Film Power</a></p></div></body></html>';

async function serveCustom(res, name) {
  const o = SLUG.test(name.slice(5)) ? await getOverride(name) : null;
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=10');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.statusCode = o ? 200 : 404;
  // AI-panelen finns på egna sidor också, så att admin kan fortsätta bygga där.
  const html = o ? o.html.replace(/<\/body>(?![\s\S]*<\/body>)/i, '<script src="/vendor/admin-ai.js" defer></script></body>') : NOT_FOUND;
  res.end(html);
}

// Används av /api/me?page=namn. Svarar 204 (ingen AI-version) eller sidans HTML.
export async function servePage(req, res, name) {
  if (isCustom(name)) return serveCustom(res, name);
  if (!PAGES[name]) { res.statusCode = 404; return res.end(); }
  // Felsökning: visar bara om en AI-version finns och om den gäller, aldrig innehållet.
  if (/[?&]debug=1/.test(req.url)) {
    const o = await getOverride(name);
    let st = null, live = null, err = '';
    try { st = await staticHash(req, name); live = (await staticPage(req, name)).hash; } catch (e) { err = e.message; }
    const last = await redis('GET', 'ai:last');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ override: o ? { at: new Date(o.at).toISOString(), baseHash: o.baseHash, request: String(o.request || '').slice(0, 80), size: o.html.length } : null, staticHashCached: st, staticHashNow: live, host: origin(req), commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7), last: last ? JSON.parse(last).at && { at: new Date(JSON.parse(last).at).toISOString(), pages: JSON.parse(last).pages } : null, err, hist: Boolean(await redis('GET', 'page:hist:' + name)) }));
  }
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
