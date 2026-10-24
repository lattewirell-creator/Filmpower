import crypto from 'node:crypto';
import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession,
  HttpError, redis, pipeline, CATEGORIES,
} from './_lib.js';

const MAX_LIST = 100;

function clean(s, max) {
  return String(s || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

export default handle(async (req, res) => {
  if (req.method === 'GET') {
    await requireSession(req);
    const ids = await redis('ZREVRANGE', 'news:idx', 0, MAX_LIST - 1);
    if (!ids.length) return send(res, 200, { items: [] });
    const raws = await redis('HMGET', 'news', ...ids);
    const items = raws.filter(Boolean).map((r) => JSON.parse(r));
    return send(res, 200, { items });
  }

  requireAppHeader(req);
  const s = await requireSession(req, 'admin');

  if (req.method === 'POST') {
    const b = await readBody(req);
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
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      title, body, category, link,
      author: s.label,
      createdAt: Date.now(),
    };
    await pipeline([
      ['HSET', 'news', item.id, JSON.stringify(item)],
      ['ZADD', 'news:idx', item.createdAt, item.id],
    ]);
    return send(res, 201, { item });
  }

  if (req.method === 'DELETE') {
    const id = queryParam(req, 'id');
    if (!id) throw new HttpError(400, 'Id saknas.');
    await pipeline([['HDEL', 'news', id], ['ZREM', 'news:idx', id]]);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
