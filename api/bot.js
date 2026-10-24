import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  handle, send, requireAppHeader, getSession, HttpError, dbReady, redis, pipeline, CATEGORIES,
} from './_lib.js';

// Nyhetsboten: hämtar filmnyheter från branschsajter en gång per dag och publicerar dem som Film Power.
// Vercel Cron anropar GET varje morgon. Admin kan också köra den direkt (POST) och se status (GET ?status=1).

export const FEEDS = [
  { name: 'Variety', url: 'https://variety.com/v/film/feed/' },
  { name: 'IndieWire', url: 'https://www.indiewire.com/feed/' },
  { name: 'Deadline', url: 'https://deadline.com/v/film/feed/' },
  { name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/c/movies/feed/' },
  { name: 'No Film School', url: 'https://nofilmschool.com/rss.xml' },
  { name: 'DiscussingFilm', url: 'https://discussingfilm.net/feed/' },
];
const MAX_AGE = 48 * 3600 * 1000;
const MODEL = 'claude-opus-5-5';

function postsPerDay() {
  const n = Number(process.env.BOT_POSTS_PER_DAY);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 3;
}

function feeds() {
  // BOT_FEEDS kan ersätta listan, t.ex. "Namn|https://…/feed, Namn2|https://…".
  if (!process.env.BOT_FEEDS) return FEEDS;
  return process.env.BOT_FEEDS.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, url] = s.includes('|') ? s.split('|') : [new URL(s).hostname, s];
    return { name: name.trim(), url: url.trim() };
  });
}

// ---------- RSS ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '–', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function text(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

// Artikelbilden ur ett RSS-inlägg: media:content, media:thumbnail, enclosure eller första <img> i texten.
function imageUrl(block) {
  const pick = (re) => { const m = block.match(re); return m ? m[1].replace(/&amp;/g, '&') : ''; };
  return pick(/<media:content[^>]*url="([^"]+)"[^>]*(?:medium="image"|type="image\/)/i)
    || pick(/<media:content[^>]*(?:medium="image"|type="image\/)[^>]*url="([^"]+)"/i)
    || pick(/<media:thumbnail[^>]*url="([^"]+)"/i)
    || pick(/<media:content[^>]*url="([^"]+\.(?:jpe?g|png|webp)(?:\?[^"]*)?)"/i)
    || pick(/<enclosure[^>]*url="([^"]+)"[^>]*type="image\//i)
    || pick(/<enclosure[^>]*type="image\/[^"]*"[^>]*url="([^"]+)"/i)
    || pick(/<img[^>]*src=["'](https?:[^"']+)["']/i)
    || pick(/&lt;img[^&]*?src=(?:&quot;|")(https?:[^&"]+)/i);
}

export function parseFeed(xml, source) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    let link = text(tag(block, 'link'));
    if (!link) { const a = block.match(/<link[^>]*href="([^"]+)"/i); link = a ? a[1] : ''; }
    const title = text(tag(block, 'title'));
    const summary = text(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded')).slice(0, 600);
    const when = Date.parse(text(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')));
    if (!title || !/^https?:\/\//.test(link)) continue;
    const image = imageUrl(block);
    items.push({ source, title: title.slice(0, 200), link, summary, image: /^https:\/\//.test(image) ? image : '', publishedAt: Number.isFinite(when) ? when : 0 });
  }
  return items;
}

async function fetchFeed(f) {
  const r = await fetch(f.url, {
    headers: { 'user-agent': 'FilmPowerNewsBot/1.0 (+https://filmpower.vercel.app)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(f.name + ': ' + r.status);
  return parseFeed(await r.text(), f.name);
}

// ---------- Urval och svensk text ----------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posts'],
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'title', 'body', 'category'],
        properties: {
          index: { type: 'integer' },
          title: { type: 'string' },
          body: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
        },
      },
    },
  },
};

const SYSTEM = `Du skriver dagens filmnyheter för Film Power, en svensk filmstudio för kortfilm och indieproduktioner. Läsarna är svenska filmskapare: regissörer, fotografer, klippare och studenter.

Välj de nyheter som är mest intressanta och användbara för dem: festivaler, nya filmer och regissörer, teknik och kameror, finansiering, distribution, jobb och branschförändringar. Undvik skvaller, rena kassasiffror och nästan likadana nyheter om samma sak. Välj gärna från olika källor.

Skriv på naturlig, levande svenska, som en kunnig kollega som berättar vad som hänt. Rubriken är kort och konkret (högst 90 tecken). Brödtexten är 2 till 4 meningar med det viktigaste och varför det spelar roll för filmskapare. Hitta inte på fakta som inte står i underlaget. Använd inga tankstreck (—). Skriv inte ut källan, den läggs till automatiskt.`;

function newsPrompt(candidates, count) {
  const list = candidates.map((c, i) => `[${i}] ${c.source}: ${c.title}\n${c.summary}`).join('\n\n');
  return `Här är de senaste nyheterna. Välj de ${count} bästa och skriv dem på svenska. Kategorier att välja mellan: ${CATEGORIES.join(', ')}.\n\n${list}`;
}

// Vilken AI som skriver de svenska texterna: Claude om ANTHROPIC_API_KEY finns, annars Groq.
function aiProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GROQ_API_KEY) return 'groq';
  return '';
}

// Ber AI:n om ett JSON-svar. schema används av Claude, hint (en beskrivning av formatet) av Groq.
async function askClaude(system, user, schema) {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude avböjde att skriva nyheterna.');
  const block = response.content.find((b) => b.type === 'text');
  return JSON.parse(block ? block.text : '{}');
}

// Groq (OpenAI-kompatibelt API). GROQ_MODEL väljer modell, annars provas två vanliga i tur och ordning.
async function askGroq(system, user, hint) {
  const models = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
  let lastError;
  for (const model of models) {
    try {
      const r = await fetch((process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system + '\n\n' + hint },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(40000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Groq ' + r.status + ': ' + ((data.error && data.error.message) || ''));
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const parsed = JSON.parse(text || '{}');
      if (parsed.posts && parsed.posts.length) return parsed;
      throw new Error('Groq gav inga inlägg.');
    } catch (err) { lastError = err; }
  }
  throw lastError;
}

function askAI(system, user, schema, hint) {
  return aiProvider() === 'claude' ? askClaude(system, user, schema) : askGroq(system, user, hint);
}

async function writeSwedish(candidates, count) {
  const hint = 'Svara endast med JSON i formen {"posts":[{"index":0,"title":"…","body":"…","category":"…"}]} där index är numret på nyheten i listan.';
  return toPosts(await askAI(SYSTEM, newsPrompt(candidates, count), SCHEMA, hint), candidates, count);
}

// ---------- Översättning av äldre engelska inlägg ----------

const TRANSLATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posts'],
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'title', 'body'],
        properties: { index: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' } },
      },
    },
  },
};

const TRANSLATE_SYSTEM = `Du översätter filmnyheter till svenska för Film Power, en svensk filmstudio. Läsarna är svenska filmskapare.

Skriv rubriken och texten på naturlig, levande svenska, inte ordagrant. Rubriken är kort och konkret (högst 90 tecken). Texten är 2 till 4 meningar med det viktigaste. Behåll namn på filmer, personer och företag. Hitta inte på fakta. Använd inga tankstreck (—).`;

// Översätter botens inlägg som publicerades på engelska (innan en AI-nyckel fanns). Högst tio åt gången.
async function translateOld() {
  const ids = await redis('ZREVRANGE', 'news:idx', 0, 199);
  if (!ids.length) return 0;
  const raws = await redis('HMGET', 'news', ...ids);
  const old = raws.filter(Boolean).map((r) => JSON.parse(r)).filter((i) => i.bot && !i.sv).slice(0, 10);
  if (!old.length) return 0;
  const list = old.map((o, i) => `[${i}] ${o.title}\n${o.body}`).join('\n\n');
  const hint = 'Svara endast med JSON i formen {"posts":[{"index":0,"title":"…","body":"…"}]} med ett objekt per nyhet, där index är numret i listan.';
  const parsed = await askAI(TRANSLATE_SYSTEM, `Översätt de här nyheterna till svenska:\n\n${list}`, TRANSLATE_SCHEMA, hint);
  const cmds = [];
  for (const p of parsed.posts || []) {
    const o = old[p.index];
    if (!o || !p.title || !p.body) continue;
    const item = { ...o, title: clean(p.title, 140), body: clean(p.body, 1500), sv: true };
    cmds.push(['HSET', 'news', o.id, JSON.stringify(item)]);
  }
  if (cmds.length) await pipeline(cmds);
  return cmds.length;
}

function clean(s, max) {
  return String(s).replace(/\s*—\s*/g, ', ').trim().slice(0, max);
}

// Gör om AI:ns svar till inlägg och kastar bort sådant som inte stämmer med listan.
function toPosts(parsed, candidates, count) {
  const used = new Set();
  return (parsed.posts || []).filter((p) => {
    if (!candidates[p.index] || used.has(p.index)) return false;
    used.add(p.index);
    return true;
  }).slice(0, count).map((p) => ({
    ...candidates[p.index],
    title: clean(p.title, 140),
    body: clean(p.body, 1500),
    category: CATEGORIES.includes(p.category) ? p.category : 'Branschnytt',
  }));
}

// Utan Claude-nyckel: de senaste nyheterna från olika källor, med originalrubrik och ingress.
function pickPlain(candidates, count) {
  const out = [], sources = new Set();
  for (const c of candidates) {
    if (out.length >= count) break;
    if (sources.has(c.source)) continue;
    sources.add(c.source);
    out.push({ ...c, title: c.title.slice(0, 140), body: c.summary.slice(0, 400) || c.title, category: 'Branschnytt' });
  }
  for (const c of candidates) {
    if (out.length >= count) break;
    if (!out.includes(c) && !out.some((o) => o.link === c.link)) out.push({ ...c, title: c.title.slice(0, 140), body: c.summary.slice(0, 400) || c.title, category: 'Branschnytt' });
  }
  return out;
}

// ---------- Bilder ----------

const MAX_IMAGE_BYTES = 640_000; // Ryms som data-URL under appens bildtak.

// Ber om mindre versioner (WordPress-sajter skalar om med ?w=), och sist originalet.
function smaller(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('w') || u.searchParams.has('width') || /\.wp\.com$|wordpress|variety|deadline|hollywoodreporter|indiewire|discussingfilm/.test(u.hostname)) {
      const key = u.searchParams.has('width') ? 'width' : 'w';
      ['h', 'height', 'resize', 'fit', 'crop'].forEach((k) => u.searchParams.delete(k));
      return [1000, 640].map((w) => { u.searchParams.set(key, String(w)); return u.toString(); }).concat(url);
    }
  } catch { /* ogiltig adress */ }
  return [url];
}

// Artikelns delningsbild (og:image), när flödet saknar bild.
async function pageImage(link) {
  try {
    const r = await fetch(link, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; FilmPowerNewsBot/1.0; +https://filmpower.vercel.app)', accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 300_000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    const url = m ? m[1].replace(/&amp;/g, '&') : '';
    return /^https:\/\//.test(url) ? url : '';
  } catch { return ''; }
}

// Hämtar bilden från flödet, och annars artikelns delningsbild.
export async function articleImage(item) {
  return (await fetchImage(item.image)) || fetchImage(await pageImage(item.link));
}

export async function fetchImage(url) {
  if (!url) return '';
  for (const u of smaller(url)) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'FilmPowerNewsBot/1.0 (+https://filmpower.vercel.app)', accept: 'image/webp,image/jpeg,image/png' }, signal: AbortSignal.timeout(8000) });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!r.ok || !/^image\/(jpeg|png|webp)$/.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES || buf.length < 2000) continue;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch { /* prova nästa */ }
  }
  return '';
}

// ---------- Körning ----------

async function run() {
  const results = await Promise.allSettled(feeds().map(fetchFeed));
  const failed = results.map((r, i) => (r.status === 'rejected' ? feeds()[i].name : null)).filter(Boolean);
  const now = Date.now();
  let all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  all = all.filter((i) => !i.publishedAt || now - i.publishedAt < MAX_AGE);
  all.sort((a, b) => b.publishedAt - a.publishedAt);

  // Hoppa över sådant som redan publicerats.
  const unique = [...new Map(all.map((i) => [i.link, i])).values()];
  const keys = unique.map((i) => crypto.createHash('sha1').update(i.link).digest('hex').slice(0, 16));
  const seen = keys.length ? await redis('HMGET', 'bot:seen', ...keys) : [];
  const candidates = unique.filter((_, i) => !seen[i]).slice(0, 30);

  const count = postsPerDay();
  let picked = [], mode = 'plain';
  if (candidates.length) {
    if (aiProvider()) {
      try { picked = await writeSwedish(candidates, count); mode = aiProvider(); } catch (err) { console.error('Nyhetsboten:', err); }
    }
    if (!picked.length) picked = pickPlain(candidates, count);
  }

  // Hämta artikelbilderna och spara dem en och en (varje bild är ett eget, stort anrop).
  const images = await Promise.all(picked.map(articleImage));
  const imageIds = [];
  for (const data of images) {
    if (!data) { imageIds.push(''); continue; }
    const id = crypto.randomBytes(8).toString('hex');
    try { await redis('SET', 'img:' + id, data); imageIds.push(id); } catch (err) { console.error('Nyhetsboten bild:', err); imageIds.push(''); }
  }

  // Lite olika tider, så att inläggen hamnar i rätt ordning i flödet.
  const cmds = [];
  picked.forEach((p, i) => {
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      title: p.title,
      body: p.body,
      source: p.source,
      category: p.category,
      link: p.link,
      image: imageIds[i],
      author: 'Film Power',
      authorKey: '',
      bot: true,
      sv: mode !== 'plain',
      createdAt: now - i * 1000,
    };
    const key = crypto.createHash('sha1').update(p.link).digest('hex').slice(0, 16);
    cmds.push(['HSET', 'news', item.id, JSON.stringify(item)], ['ZADD', 'news:idx', item.createdAt, item.id], ['HSET', 'bot:seen', key, String(now)]);
  });
  if (cmds.length) await pipeline(cmds);

  // Översätt det som tidigare publicerats på engelska, nu när en AI-nyckel finns.
  let translated = 0;
  if (aiProvider()) {
    try { translated = await translateOld(); } catch (err) { console.error('Nyhetsboten översättning:', err); }
  }

  const status = { at: now, posted: picked.length, translated, images: imageIds.filter(Boolean).length, mode, found: all.length, failed };
  await redis('SET', 'bot:last', JSON.stringify(status));
  return status;
}

function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.authorization === 'Bearer ' + secret;
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

export default handle(async (req, res) => {
  if (!dbReady()) throw new HttpError(503, 'Databasen är inte kopplad än.');
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.searchParams.get('status')) {
    const s = await getSession(req);
    if (!s || s.role !== 'admin') throw new HttpError(403, 'Bara admin kan se nyhetsboten.');
    const last = await redis('GET', 'bot:last');
    return send(res, 200, { last: last ? JSON.parse(last) : null, ai: aiProvider(), perDay: postsPerDay() });
  }

  if (req.method === 'GET') {
    if (!isCron(req)) throw new HttpError(401, 'Ogiltigt anrop.');
    // En körning per dygn, även om Vercel skulle anropa två gånger.
    const day = new Date().toISOString().slice(0, 10);
    const ok = await redis('SET', 'bot:day:' + day, '1', 'NX', 'EX', 172800);
    if (!ok) return send(res, 200, { skipped: true });
    return send(res, 200, await run());
  }

  if (req.method === 'POST') {
    requireAppHeader(req);
    const s = await getSession(req);
    if (!s || s.role !== 'admin') throw new HttpError(403, 'Bara admin kan köra nyhetsboten.');
    return send(res, 200, await run());
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
