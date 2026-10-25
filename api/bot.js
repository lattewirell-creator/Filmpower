import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  handle, send, requireAppHeader, getSession, HttpError, dbReady, redis, pipeline, CATEGORIES, readBody, rateLimit, clientIp,
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
    || pick(/<enclosure[^>]*type="image\/[^"]*"[^>]*url="([^"]+)"/i);
}

// Första bilden i artikeltexten. Osäkrare, den kan höra till en annan artikel eller en annons.
function inlineImageUrl(block) {
  const m = block.match(/<img[^>]*src=["'](https?:[^"']+)["']/i) || block.match(/&lt;img[^&]*?src=(?:&quot;|")(https?:[^&"]+)/i);
  return m ? m[1].replace(/&amp;/g, '&') : '';
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
    const image = imageUrl(block), inline = inlineImageUrl(block);
    const https = (u) => (/^https:\/\//.test(u) ? u : '');
    items.push({ source, title: title.slice(0, 200), link, summary, image: https(image), inlineImage: https(inline), publishedAt: Number.isFinite(when) ? when : 0 });
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
// Två steg så att texten alltid hör till rätt artikel och bara bygger på den:
// 1) AI:n väljer vilka nyheter som är bäst (bara numren i listan).
// 2) Varje nyhet skrivs om för sig, med enbart sin egen rubrik och ingress som underlag, och kontrolleras sedan.

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pick'],
  properties: { pick: { type: 'array', items: { type: 'integer' } } },
};

const PICK_SYSTEM = `Du väljer dagens filmnyheter för Film Power, en svensk filmstudio för kortfilm och indieproduktioner. Läsarna är svenska filmskapare: regissörer, fotografer, klippare och studenter.

Välj de nyheter som är mest intressanta och användbara för dem: festivaler, nya filmer och regissörer, teknik och kameror, finansiering, distribution, jobb och branschförändringar. Undvik skvaller, rena kassasiffror och nästan likadana nyheter om samma sak. Välj gärna från olika källor.`;

const WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'body', 'category'],
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
  },
};

const WRITE_SYSTEM = `Du skriver om en filmnyhet på svenska för Film Power, en svensk filmstudio. Läsarna är svenska filmskapare.

Regler, i den här ordningen:
1. Använd bara uppgifter som står i underlaget. Lägg aldrig till namn, siffror, datum, citat, plattformar eller bakgrund som inte står där, inte ens om du tror att du vet.
2. Rubriken ska säga samma sak som originalrubriken, kort och konkret (högst 90 tecken).
3. Texten är 1 till 3 meningar. Är underlaget kort blir texten kort. Hellre en mening som stämmer än tre som gissar.
4. Behåll namn på filmer, personer och företag som i originalet.
5. Skriv naturlig, enkel svenska. Inga tankstreck (—). Skriv inte ut källan, den läggs till automatiskt.
6. Kategori: välj en av ${CATEGORIES.join(', ')}.`;

function articleText(c) {
  return `Källa: ${c.source}\nRubrik: ${c.title}\nIngress: ${c.summary || '(ingen ingress)'}`;
}

// Vilken AI som skriver de svenska texterna: Claude om ANTHROPIC_API_KEY finns, annars Groq.
function aiProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GROQ_API_KEY) return 'groq';
  return '';
}

// Ber AI:n om ett JSON-svar. schema används av Claude, hint (en beskrivning av formatet) av Groq.
// valid kontrollerar att svaret har rätt form.
async function askClaude(system, user, schema, valid) {
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
  const parsed = JSON.parse(block ? block.text : '{}');
  if (!valid(parsed)) throw new Error('Claude gav ett svar i fel form.');
  return parsed;
}

// Groq (OpenAI-kompatibelt API). GROQ_MODEL väljer modell, annars provas två vanliga i tur och ordning.
async function askGroq(system, user, hint, valid) {
  const models = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
  const errors = [];
  for (const model of models) {
    try {
      const r = await fetch((process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 8000,
          // gpt-oss tänker innan den svarar. Lite tänkande räcker och lämnar plats åt själva svaret.
          ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system + '\n\n' + hint },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Groq ' + r.status + ': ' + ((data.error && data.error.message) || ''));
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const parsed = JSON.parse(text || '{}');
      if (valid(parsed)) return parsed;
      throw new Error('svar i fel form');
    } catch (err) { errors.push(model + ': ' + err.message); }
  }
  throw new Error(errors.join(' | '));
}

function askAI(system, user, schema, hint, valid) {
  return aiProvider() === 'claude' ? askClaude(system, user, schema, valid) : askGroq(system, user, hint, valid);
}

// Alla tal i en text, utan mellanslag och skiljetecken ("2 000" och "2,000" blir "2000").
function numbersIn(text) {
  return (String(text).match(/\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?/g) || []).map((n) => n.replace(/[.,\s]/g, ''));
}

// En omskriven nyhet godkänns bara om varje tal i den också finns i underlaget.
// Det fångar den vanligaste sortens påhitt: siffror, belopp, år och datum som inte står i artikeln.
export function faithful(c, out) {
  const src = numbersIn(c.title + ' ' + c.summary);
  return numbersIn(out.title + ' ' + out.body).every((n) => src.some((x) => x === n || x.startsWith(n)));
}

// Skriver om en nyhet på svenska. Ger null om AI:n inte klarar det utan att hitta på.
async function rewriteOne(c) {
  const hint = 'Svara endast med JSON i formen {"title":"…","body":"…","category":"…"}.';
  const valid = (p) => p && typeof p.title === 'string' && typeof p.body === 'string' && p.title.trim() && p.body.trim();
  let extra = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = await askAI(WRITE_SYSTEM, articleText(c) + '\n\nSkriv om den här nyheten på svenska.' + extra, WRITE_SCHEMA, hint, valid);
    const out = { title: clean(p.title, 140), body: clean(p.body, 1500), category: CATEGORIES.includes(p.category) ? p.category : 'Branschnytt' };
    if (faithful(c, out)) return out;
    extra = '\n\nOBS: Förra försöket innehöll siffror som inte står i underlaget. Använd bara det som står ovan.';
  }
  return null;
}

async function writeSwedish(candidates, count) {
  const list = candidates.map((c, i) => `[${i}] ${c.source}: ${c.title}\n${c.summary}`).join('\n\n');
  let order = [];
  try {
    const p = await askAI(PICK_SYSTEM, `Välj de ${count + 2} bästa nyheterna, bäst först. Svara med deras nummer.\n\n${list}`, PICK_SCHEMA,
      'Svara endast med JSON i formen {"pick":[3,0,7]} med numren på nyheterna, bäst först.', (x) => x && Array.isArray(x.pick));
    order = p.pick.filter((i) => Number.isInteger(i) && candidates[i]);
  } catch (err) { console.error('Nyhetsboten urval:', err); }
  // Fyll på med de senaste nyheterna, så att det finns reserver om någon text underkänns.
  candidates.forEach((_, i) => order.push(i));
  order = [...new Set(order)];

  const out = [];
  let errors = 0;
  for (let start = 0; out.length < count && start < order.length && start < count * 3; start += count) {
    const batch = order.slice(start, start + count - out.length);
    const written = await Promise.all(batch.map((i) => rewriteOne(candidates[i]).catch((err) => { errors++; console.error('Nyhetsboten:', err); return null; })));
    written.forEach((w, k) => { if (w && out.length < count) out.push({ ...candidates[batch[k]], ...w }); });
    if (errors && !out.length) throw new Error('AI:n svarade inte.');
  }
  return out;
}

// ---------- Rätta botens äldre inlägg ----------

// Skriver om botens äldre inlägg med den nya metoden: engelska inlägg och sådana som skrevs med
// den gamla metoden (då AI:n fick alla nyheter på en gång och kunde blanda ihop dem).
// Underlaget hämtas från flödet via länken. Inlägg som inte längre finns i flöden räknas som okontrollerade.
async function repairOld(feedItems) {
  const ids = await redis('ZREVRANGE', 'news:idx', 0, 199);
  if (!ids.length) return { repaired: 0, unverified: 0 };
  const raws = await redis('HMGET', 'news', ...ids);
  const old = raws.filter(Boolean).map((r) => JSON.parse(r)).filter((i) => i.bot && (i.v || 0) < 3).slice(0, 10);
  const byLink = new Map(feedItems.map((i) => [i.link, i]));
  let repaired = 0, unverified = 0;
  await Promise.all(old.map(async (o) => {
    // Engelska inlägg innehåller själva originalet, så det duger som underlag.
    const c = byLink.get(o.link) || (!o.sv ? { source: o.source, title: o.title, summary: o.body } : null);
    if (!c) { unverified++; return; }
    const w = await rewriteOne(c).catch(() => null);
    if (!w) return;
    await redis('HSET', 'news', o.id, JSON.stringify({ ...o, ...w, sv: true, v: 3 }));
    repaired++;
  }));
  return { repaired, unverified };
}

// Byter bild på botens äldre inlägg till artikelns delningsbild (de kunde få en bild som hörde till en annan artikel).
async function refreshImages() {
  const ids = await redis('ZREVRANGE', 'news:idx', 0, 199);
  if (!ids.length) return 0;
  const raws = await redis('HMGET', 'news', ...ids);
  const old = raws.filter(Boolean).map((r) => JSON.parse(r)).filter((i) => i.bot && !i.img2 && i.link).slice(0, 10);
  let fixed = 0;
  for (const o of old) {
    const data = await fetchImage(await pageImage(o.link));
    const item = { ...o, img2: true };
    if (data) {
      const id = crypto.randomBytes(8).toString('hex');
      await redis('SET', 'img:' + id, data);
      if (o.image) await redis('DEL', 'img:' + o.image);
      item.image = id;
      fixed++;
    }
    await redis('HSET', 'news', o.id, JSON.stringify(item));
  }
  return fixed;
}

// Tar bort botens inlägg som skrevs med den gamla metoden (engelska eller ej kontrollerade mot källan).
// Länkarna släpps, så att boten kan skriva samma nyheter rätt nästa gång.
async function purgeOld() {
  const ids = await redis('ZREVRANGE', 'news:idx', 0, 999);
  if (!ids.length) return { removed: 0 };
  const raws = await redis('HMGET', 'news', ...ids);
  const old = raws.filter(Boolean).map((r) => JSON.parse(r)).filter((i) => i.bot && (i.v || 0) < 3);
  const cmds = [];
  for (const o of old) {
    cmds.push(['HDEL', 'news', o.id], ['ZREM', 'news:idx', o.id], ['DEL', 'comments:' + o.id],
      ['HDEL', 'news:likes', o.id], ['HDEL', 'news:comments', o.id], ['HDEL', 'news:views', o.id]);
    if (o.image) cmds.push(['DEL', 'img:' + o.image]);
    if (o.link) cmds.push(['HDEL', 'bot:seen', crypto.createHash('sha1').update(o.link).digest('hex').slice(0, 16)]);
  }
  if (cmds.length) await pipeline(cmds);
  return { removed: old.length };
}

function clean(s, max) {
  return String(s).replace(/\s*—\s*/g, ', ').trim().slice(0, max);
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
export async function pageImage(link) {
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

// Den bild som säkrast hör till nyheten: först den flödet pekar ut, sedan artikelns delningsbild
// (og:image) och sist första bilden i texten.
export async function articleImage(item) {
  return (await fetchImage(item.image))
    || (await fetchImage(await pageImage(item.link)))
    || fetchImage(item.inlineImage);
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
  let picked = [], mode = 'plain', aiError = '';
  if (candidates.length) {
    if (aiProvider()) {
      try { picked = await writeSwedish(candidates, count); mode = aiProvider(); } catch (err) { console.error('Nyhetsboten:', err); aiError = String(err.message || err).slice(0, 300); }
    }
    // Med en AI-nyckel publiceras inget på engelska. Går AI:n inte att nå försöker boten igen nästa gång.
    if (!picked.length && !aiProvider()) picked = pickPlain(candidates, count);
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
      img2: true,
      sv: mode !== 'plain',
      v: mode !== 'plain' ? 3 : 0,
      createdAt: now - i * 1000,
    };
    const key = crypto.createHash('sha1').update(p.link).digest('hex').slice(0, 16);
    cmds.push(['HSET', 'news', item.id, JSON.stringify(item)], ['ZADD', 'news:idx', item.createdAt, item.id], ['HSET', 'bot:seen', key, String(now)]);
  });
  if (cmds.length) await pipeline(cmds);

  // Rätta äldre inlägg: översätt engelska och skriv om sådana som skrevs med den gamla metoden.
  let translated = 0, unverified = 0;
  if (aiProvider()) {
    try { ({ repaired: translated, unverified } = await repairOld(all)); } catch (err) { console.error('Nyhetsboten rättning:', err); aiError = aiError || String(err.message || err).slice(0, 300); }
  }

  let imagesFixed = 0;
  try { imagesFixed = await refreshImages(); } catch (err) { console.error('Nyhetsboten bilder:', err); }

  const status = { at: now, posted: picked.length, translated, unverified, imagesFixed, error: aiError, images: imageIds.filter(Boolean).length, mode, found: all.length, failed };
  await redis('SET', 'bot:last', JSON.stringify(status));
  return status;
}

function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.authorization === 'Bearer ' + secret;
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

// ---------- Filmguiden (chatten på startsidan) ----------

const GUIDE_SYSTEM = `Du är Filmguiden hos Film Power, en svensk filmstudio för kortfilm och indieproduktioner. Du hjälper besökare att hitta ett filmset (utrustning) som passar deras budget och projekt, och ger konkreta råd om hur de ska gå till väga.

Så jobbar du:
- Ta reda på vad de ska filma (YouTube-video, vlogg, reklamfilm, musikvideo, kortfilm, dokumentär, långfilm eller större produktion) och budgeten i kronor. Saknas något, fråga kort om det innan du föreslår ett set. Fråga gärna om de redan har något, t.ex. en mobil eller kamera.
- Föreslå ett komplett set inom budgeten: kamera, objektiv, ljud (mikrofon), ljus, stativ eller gimbal, lagring och eventuell programvara för klippning. Ange ungefärliga priser i kronor och summera totalen. Var tydlig med att priserna är ungefärliga och varierar mellan butiker och begagnat.
- Tipsa om att hyra eller köpa begagnat när det ger mer för pengarna, och om var budgeten gör mest nytta (ljud och ljus slår ofta en dyrare kamera).
- Anpassa råden efter projektet: för YouTube enkelhet och bra ljud, för kortfilm och musikvideo bildkänsla och ljus, för större filmer planering, team, tillstånd, försäkring och att hyra proffsutrustning.
- Ge gärna en kort plan i steg: förberedelse, inspelning, klippning.
- När det passar, nämn att Film Power kan hjälpa till med inspelning och klippning. Priser: reklamfilm 150 kr, kortfilm 250 kr, långfilm 500 kr för filmning. Kontakt: FILMPOWER.vercel@gmail.com.

Skriv på naturlig, vänlig svenska (eller på besökarens språk om de skriver på ett annat). Var konkret och kortfattad, högst cirka 200 ord, och använd korta punktlistor för set och priser. Använd inga tankstreck (—). Svara bara om film, video och foto. Hitta inte på specifika butikspriser som säkra fakta.`;

const MAX_TURNS = 12, MAX_CHARS = 1200;

async function guideReply(history) {
  if (aiProvider() === 'claude') {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: GUIDE_SYSTEM,
      messages: history,
    });
    if (response.stop_reason === 'refusal') return 'Det kan jag tyvärr inte hjälpa till med. Fråga mig gärna om filmutrustning och inspelning!';
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  const models = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
  const errors = [];
  for (const model of models) {
    try {
      const r = await fetch((process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.5,
          max_tokens: 3000,
          ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
          messages: [{ role: 'system', content: GUIDE_SYSTEM }, ...history],
        }),
        signal: AbortSignal.timeout(40000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Groq ' + r.status + ': ' + ((data.error && data.error.message) || ''));
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text && text.trim()) return text.trim();
      throw new Error('tomt svar');
    } catch (err) { errors.push(model + ': ' + err.message); }
  }
  throw new Error(errors.join(' | '));
}

async function guideChat(req, res) {
  requireAppHeader(req);
  if (!aiProvider()) throw new HttpError(503, 'Filmguiden är inte igång än.');
  await rateLimit('rl:guide:' + clientIp(req), 40, 3600, 'Du har frågat mycket på kort tid. Vänta en stund och försök igen.');
  const b = await readBody(req, 40_000);
  const history = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? MAX_CHARS : 4000) }));
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'Skriv en fråga först.');
  try {
    return send(res, 200, { reply: (await guideReply(history)).replace(/\s*—\s*/g, ', ') });
  } catch (err) {
    console.error('Filmguiden:', err);
    throw new HttpError(502, 'Filmguiden svarar inte just nu. Försök igen om en stund.');
  }
}

export default handle(async (req, res) => {
  if (!dbReady()) throw new HttpError(503, 'Databasen är inte kopplad än.');
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.searchParams.get('action') === 'guide') return guideChat(req, res);

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
    if (url.searchParams.get('action') === 'purge') return send(res, 200, await purgeOld());
    return send(res, 200, await run());
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
