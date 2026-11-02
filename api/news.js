import crypto from 'node:crypto';
import { del } from '@vercel/blob';
import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession,
  HttpError, redis, pipeline, CATEGORIES, readerSession, withStats, withAuthors, rateLimit, actorId, IMAGE_RE,
} from './_lib.js';
import { notify, mentionsIn } from './_social.js';

const MAX_LIST = 200;
// Bilden krymps i webbläsaren innan uppladdning. Taket håller oss under Upstash gräns per anrop.
const MAX_IMAGE_CHARS = 900_000;
const VIDEO_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/videos\/[A-Za-z0-9._\/-]+\.(mp4|webm|mov)$/i;

function clean(s, max) {
  return String(s || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

export default handle(async (req, res) => {
  // Nyheterna är öppna för alla. Att skriva kräver inloggning.
  if (req.method === 'GET') {
    const s = await readerSession(req);
    const ids = await redis('ZREVRANGE', 'news:idx', 0, MAX_LIST - 1);
    if (!ids.length) return send(res, 200, { items: [] });
    const raws = await redis('HMGET', 'news', ...ids);
    const items = raws.filter(Boolean).map((r) => JSON.parse(r));
    return send(res, 200, { items: await withStats(await withAuthors(items, s), s) });
  }

  requireAppHeader(req);
  const s = await requireSession(req);
  const admin = s.role === 'admin';

  if (req.method === 'POST') {
    const b = await readBody(req, 1_000_000);
    // Bloggen: korta inlägg utan rubrik, som på Twitter. Alla med eget konto får skriva där.
    const blog = b.kind === 'blog';
    if (blog) {
      if (!s.user && !admin) throw new HttpError(403, 'Skapa ett eget konto för att skriva i bloggen.');
      if (!admin) await rateLimit('rl:blog:' + actorId(s), 30, 3600, 'Du har skrivit många inlägg på kort tid. Vänta en stund.');
    } else {
      if (!admin && !s.verified) throw new HttpError(403, 'Bara verifierade konton kan publicera nyheter.');
      if (!admin) await rateLimit('rl:post:' + actorId(s), 10, 3600, 'Du har publicerat många inlägg på kort tid. Vänta en stund.');
    }
    const title = blog ? '' : clean(b.title, 140);
    const body = clean(b.body, blog ? 1000 : 5000);
    const category = blog ? '' : CATEGORIES.includes(b.category) ? b.category : CATEGORIES[0];
    let link = clean(b.link, 500);
    if (!blog && !title) throw new HttpError(400, 'Nyheten behöver en rubrik.');
    if (!body && !(blog && b.image)) throw new HttpError(400, blog ? 'Skriv något först.' : 'Nyheten behöver en text.');
    if (link) {
      try {
        const u = new URL(link);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
        link = u.toString();
      } catch {
        throw new HttpError(400, 'Länken måste börja med https://');
      }
    }

    // Videon ligger redan i Vercel Blob (uppladdad direkt från webbläsaren). Här sparas bara adressen.
    let video = '';
    if (b.video) {
      video = String(b.video);
      if (!VIDEO_RE.test(video)) throw new HttpError(400, 'Ogiltig video.');
    }

    let image = '';
    if (b.image) {
      const data = String(b.image);
      if (!IMAGE_RE.test(data)) throw new HttpError(400, 'Bilden måste vara JPG, PNG eller WebP.');
      if (data.length > MAX_IMAGE_CHARS) throw new HttpError(413, 'Bilden är för stor. Prova en mindre bild.');
      image = crypto.randomBytes(8).toString('hex');
      await redis('SET', 'img:' + image, data);
    }

    // Citat: ett nytt inlägg som visar ett annat inlägg inbäddat.
    let quoteOf = '';
    if (b.quoteOf) {
      quoteOf = String(b.quoteOf);
      if (!/^[a-f0-9]{12}$/.test(quoteOf) || !(await redis('HEXISTS', 'news', quoteOf))) throw new HttpError(400, 'Inlägget du citerar finns inte längre.');
    }

    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      title, body, category, link, image, video, ...(quoteOf ? { quoteOf } : {}), ...(blog ? { kind: 'blog' } : {}),
      author: s.label,
      authorKey: s.user || '',
      createdAt: Date.now(),
    };
    await pipeline([
      ['HSET', 'news', item.id, JSON.stringify(item)],
      ['ZADD', 'news:idx', item.createdAt, item.id],
    ]);
    // Notiser: den som citeras och de som @-taggas.
    const quoted = quoteOf ? JSON.parse(await redis('HGET', 'news', quoteOf)).authorKey || 'filmpower' : '';
    if (quoted) await notify(s, quoted, 'quote', { postId: item.id, text: body });
    for (const k of mentionsIn(title + ' ' + body)) if (k !== quoted) await notify(s, k, 'mention', { postId: item.id, text: body });
    const [created] = await withAuthors([item], s);
    return send(res, 201, { item: created });
  }

  // Fäst eller lossa ett inlägg. Fästa inlägg visas överst.
  if (req.method === 'PATCH') {
    if (!admin) throw new HttpError(403, 'Bara admin kan fästa inlägg.');
    const id = queryParam(req, 'id');
    const raw = id && (await redis('HGET', 'news', id));
    if (!raw) throw new HttpError(404, 'Nyheten finns inte.');
    const { pinned } = await readBody(req);
    const item = { ...JSON.parse(raw), pinned: Boolean(pinned), pinnedAt: pinned ? Date.now() : 0 };
    await redis('HSET', 'news', id, JSON.stringify(item));
    return send(res, 200, { item });
  }

  if (req.method === 'DELETE') {
    const id = queryParam(req, 'id');
    if (!id) throw new HttpError(400, 'Id saknas.');
    const raw = await redis('HGET', 'news', id);
    if (!raw) throw new HttpError(404, 'Nyheten finns inte.');
    if (!admin && JSON.parse(raw).authorKey !== s.user) throw new HttpError(403, 'Du kan bara ta bort dina egna inlägg.');
    const cmds = [
      ['HDEL', 'news', id], ['ZREM', 'news:idx', id], ['DEL', 'comments:' + id],
      ['HDEL', 'news:likes', id], ['HDEL', 'news:comments', id], ['HDEL', 'news:views', id], ['HDEL', 'news:reposts', id],
    ];
    const { image, video } = JSON.parse(raw);
    if (image) cmds.push(['DEL', 'img:' + image]);
    await pipeline(cmds);
    if (video && process.env.BLOB_READ_WRITE_TOKEN) await del(video).catch((err) => console.error('Kunde inte ta bort videon:', err));
    return send(res, 200, { ok: true });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
