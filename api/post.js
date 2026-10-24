import crypto from 'node:crypto';
import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession, HttpError,
  redis, pipeline, rateLimit, actorId, displayName, withStats,
} from './_lib.js';

const MAX_COMMENT = 1000;

// Ett enskilt inlägg: läsa (räknar en visning), gilla, spara, kommentera och ta bort kommentarer.
export default handle(async (req, res) => {
  const s = await requireSession(req);
  const a = actorId(s);
  const id = queryParam(req, 'id') || '';
  const raw = id && (await redis('HGET', 'news', id));
  if (!raw) throw new HttpError(404, 'Inlägget finns inte längre.');

  if (req.method === 'GET') {
    const [, flat] = await pipeline([
      ['HINCRBY', 'news:views', id, 1],
      ['HGETALL', 'comments:' + id],
    ]);
    const [item] = await withStats([JSON.parse(raw)], s);
    const comments = [];
    for (let i = 0; i < flat.length; i += 2) {
      const c = JSON.parse(flat[i + 1]);
      comments.push({
        id: c.id, author: c.author, isAdmin: c.isAdmin, text: c.text, createdAt: c.createdAt,
        canDelete: s.role === 'admin' || c.actor === a,
      });
    }
    comments.sort((x, y) => y.createdAt - x.createdAt);
    return send(res, 200, { item, comments });
  }

  requireAppHeader(req);
  const action = queryParam(req, 'action');

  if (req.method === 'POST' && (action === 'like' || action === 'unlike')) {
    const like = action === 'like';
    const changed = await redis(like ? 'SADD' : 'SREM', 'liked:' + a, id);
    let likes = Number(await redis('HGET', 'news:likes', id)) || 0;
    if (changed) likes = await redis('HINCRBY', 'news:likes', id, like ? 1 : -1);
    return send(res, 200, { liked: like, likes: Math.max(0, likes) });
  }

  if (req.method === 'POST' && (action === 'save' || action === 'unsave')) {
    const save = action === 'save';
    await redis(save ? 'SADD' : 'SREM', 'saved:' + a, id);
    return send(res, 200, { saved: save });
  }

  if (req.method === 'POST' && action === 'comment') {
    const b = await readBody(req, 20_000);
    const text = String(b.text || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_COMMENT);
    if (!text) throw new HttpError(400, 'Skriv något först.');
    await rateLimit('rl:comment:' + a, 20, 600, 'Du har kommenterat mycket på kort tid. Vänta några minuter.');
    const c = {
      id: crypto.randomBytes(6).toString('hex'),
      author: displayName(s),
      isAdmin: s.role === 'admin',
      actor: a,
      text,
      createdAt: Date.now(),
    };
    const [, count] = await pipeline([
      ['HSET', 'comments:' + id, c.id, JSON.stringify(c)],
      ['HINCRBY', 'news:comments', id, 1],
    ]);
    return send(res, 201, {
      comment: { id: c.id, author: c.author, isAdmin: c.isAdmin, text: c.text, createdAt: c.createdAt, canDelete: true },
      comments: count,
    });
  }

  if (req.method === 'DELETE') {
    const cid = queryParam(req, 'comment') || '';
    const craw = cid && (await redis('HGET', 'comments:' + id, cid));
    if (!craw) throw new HttpError(404, 'Kommentaren finns inte.');
    const c = JSON.parse(craw);
    if (s.role !== 'admin' && c.actor !== a) throw new HttpError(403, 'Du kan bara ta bort dina egna kommentarer.');
    const [, count] = await pipeline([
      ['HDEL', 'comments:' + id, cid],
      ['HINCRBY', 'news:comments', id, -1],
    ]);
    return send(res, 200, { ok: true, comments: Math.max(0, count) });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
