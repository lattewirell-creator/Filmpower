import crypto from 'node:crypto';
import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession, HttpError,
  redis, pipeline, rateLimit, readerSession, actorId, displayName, withStats, withAuthors, affKey, orgInfo,
} from './_lib.js';

const MAX_COMMENT = 1000;

// Ett enskilt inlägg: läsa (räknar en visning), gilla, spara, kommentera och ta bort kommentarer.
export default handle(async (req, res) => {
  // Alla får läsa inlägg och kommentarer. Gilla, spara och kommentera kräver inloggning.
  const s = req.method === 'GET' ? await readerSession(req) : await requireSession(req);
  const a = actorId(s);
  const id = queryParam(req, 'id') || '';
  const raw = id && (await redis('HGET', 'news', id));
  if (!raw) throw new HttpError(404, 'Inlägget finns inte längre.');

  if (req.method === 'GET') {
    const [, flat] = await pipeline([
      ['HINCRBY', 'news:views', id, 1],
      ['HGETALL', 'comments:' + id],
    ]);
    const [item] = await withStats(await withAuthors([JSON.parse(raw)], s), s);
    const raws = [];
    for (let i = 0; i < flat.length; i += 2) raws.push(JSON.parse(flat[i + 1]));
    const userKeys = [...new Set(raws.filter((c) => c.actor.startsWith('u:')).map((c) => c.actor.slice(2)))];
    const accounts = new Map();
    if (userKeys.length) {
      const rows = await redis('HMGET', 'users', ...userKeys);
      rows.forEach((u, i) => { if (u) accounts.set(userKeys[i], JSON.parse(u)); });
    }
    const orgs = await orgInfo([...accounts.values()].map(affKey));
    const comments = raws.map((c) => {
      const acc = c.actor.startsWith('u:') ? accounts.get(c.actor.slice(2)) : null;
      if (c.anon) {
        return {
          id: c.id, author: 'Anonym', anon: true, isAdmin: false, verified: false, avatar: '', username: '',
          text: c.text, createdAt: c.createdAt, canDelete: s.role === 'admin' || c.actor === a,
          realAuthor: s.role === 'admin' ? (acc ? acc.displayName || acc.username : c.author) : undefined,
        };
      }
      return {
      id: c.id, author: acc ? acc.displayName || acc.username : c.author, isAdmin: c.isAdmin, text: c.text, createdAt: c.createdAt,
      verified: Boolean(acc && acc.verified),
      affiliate: (acc && orgs.get(affKey(acc))) || null,
      avatar: acc ? acc.avatar || '' : '',
      username: acc ? acc.username : '',
      canDelete: s.role === 'admin' || c.actor === a,
      };
    });
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
      anon: Boolean(s.anon),
      actor: a,
      text,
      createdAt: Date.now(),
    };
    const [, count] = await pipeline([
      ['HSET', 'comments:' + id, c.id, JSON.stringify(c)],
      ['HINCRBY', 'news:comments', id, 1],
    ]);
    const myOrg = s.affiliateOf ? (await orgInfo([s.affiliateOf])).get(s.affiliateOf) || null : null;
    const shown = c.anon
      ? { id: c.id, author: 'Anonym', anon: true, isAdmin: false, verified: false, avatar: '', username: '', realAuthor: s.role === 'admin' ? c.author : undefined }
      : { id: c.id, author: c.author, isAdmin: c.isAdmin, verified: Boolean(s.verified), affiliate: myOrg, avatar: s.avatar || '', username: s.user || '' };
    return send(res, 201, {
      comment: { ...shown, text: c.text, createdAt: c.createdAt, canDelete: true },
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
