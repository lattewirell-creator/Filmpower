import crypto from 'node:crypto';
import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession,
  HttpError, redis, pipeline, CATEGORIES, withStats, withAuthors, rateLimit, actorId, IMAGE_RE,
} from './_lib.js';

const MAX_LIST = 200;
// Bilden krymps i webbläsaren innan uppladdning. Taket håller oss under Upstash gräns per anrop.
const MAX_IMAGE_CHARS = 900_000;

function clean(s, max) {
  return String(s || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

export default handle(async (req, res) => {
  if (req.method === 'GET') {
    const s = await requireSession(req);
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
    if (!admin && !s.verified) throw new HttpError(403, 'Bara verifierade konton kan publicera inlägg.');
    if (!admin) await rateLimit('rl:post:' + actorId(s), 10, 3600, 'Du har publicerat många inlägg på kort tid. Vänta en stund.');
    const b = await readBody(req, 1_000_000);
    const title = clean(b.title, 140);
    const body = clean(b.body, 5000);
    const category = CATEGORIES.includes(b.category) ? b.category : CATEGORIES[0];
    let link = clean(b.link, 500);
    if (!title) throw new HttpError(400, 'Nyheten behöver en rubrik.');
    if (!body) throw new HttpError(400, 'Nyheten behöver en text.');
    if (link) {
      try {
        const u = new URL(link);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
        link = u.toString();
      } catch {
        throw new HttpError(400, 'Länken måste börja med https://');
      }
    }

    let image = '';
    if (b.image) {
      const data = String(b.image);
      if (!IMAGE_RE.test(data)) throw new HttpError(400, 'Bilden måste vara JPG, PNG eller WebP.');
      if (data.length > MAX_IMAGE_CHARS) throw new HttpError(413, 'Bilden är för stor. Prova en mindre bild.');
      image = crypto.randomBytes(8).toString('hex');
      await redis('SET', 'img:' + image, data);
    }

    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      title, body, category, link, image,
      author: s.label,
      authorKey: s.user || '',
      createdAt: Date.now(),
    };
    await pipeline([
      ['HSET', 'news', item.id, JSON.stringify(item)],
      ['ZADD', 'news:idx', item.createdAt, item.id],
    ]);
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
      ['HDEL', 'news:likes', id], ['HDEL', 'news:comments', id], ['HDEL', 'news:views', id],
    ];
    const { image } = JSON.parse(raw);
    if (image) cmds.push(['DEL', 'img:' + image]);
    await pipeline(cmds);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
