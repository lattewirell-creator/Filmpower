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
  { name: 'Cineuropa', url: 'https://cineuropa.org/en/rss/' },
  { name: 'Culture Crave', url: 'https://culturecrave.co/feed/' },
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
    items.push({ source, title: title.slice(0, 200), link, summary, publishedAt: Number.isFinite(when) ? when : 0 });
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

async function writeSwedish(candidates, count) {
  const client = new Anthropic();
  const list = candidates.map((c, i) => `[${i}] ${c.source}: ${c.title}\n${c.summary}`).join('\n\n');
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Här är de senaste nyheterna. Välj de ${count} bästa och skriv dem på svenska. Kategorier att välja mellan: ${CATEGORIES.join(', ')}.\n\n${list}` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude avböjde att skriva nyheterna.');
  const block = response.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(block ? block.text : '{}');
  const used = new Set();
  return (parsed.posts || []).filter((p) => {
    if (!candidates[p.index] || used.has(p.index)) return false;
    used.add(p.index);
    return true;
  }).slice(0, count).map((p) => ({
    ...candidates[p.index],
    title: String(p.title).replace(/\s*—\s*/g, ', ').trim().slice(0, 140),
    body: String(p.body).replace(/\s*—\s*/g, ', ').trim().slice(0, 1500),
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
    if (process.env.ANTHROPIC_API_KEY) {
      try { picked = await writeSwedish(candidates, count); mode = 'ai'; } catch (err) { console.error('Nyhetsboten:', err); }
    }
    if (!picked.length) picked = pickPlain(candidates, count);
  }

  // Lite olika tider, så att inläggen hamnar i rätt ordning i flödet.
  const cmds = [];
  picked.forEach((p, i) => {
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      title: p.title,
      body: p.body + '\n\nKälla: ' + p.source,
      category: p.category,
      link: p.link,
      image: '',
      author: 'Film Power',
      authorKey: '',
      bot: true,
      createdAt: now - i * 1000,
    };
    const key = crypto.createHash('sha1').update(p.link).digest('hex').slice(0, 16);
    cmds.push(['HSET', 'news', item.id, JSON.stringify(item)], ['ZADD', 'news:idx', item.createdAt, item.id], ['HSET', 'bot:seen', key, String(now)]);
  });
  if (cmds.length) await pipeline(cmds);

  const status = { at: now, posted: picked.length, mode, found: all.length, failed };
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
    return send(res, 200, { last: last ? JSON.parse(last) : null, ai: Boolean(process.env.ANTHROPIC_API_KEY), perDay: postsPerDay() });
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
