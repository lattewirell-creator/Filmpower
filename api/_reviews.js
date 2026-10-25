// Recensioner som besökare skriver själva. Visas med widgeten vendor/reviews.js.
// GET /api/me?reviews=1 listar, POST skickar en ny, DELETE &id=... tar bort (bara admin).
import crypto from 'node:crypto';
import { send, readBody, queryParam, requireAppHeader, requireSession, HttpError, redis, pipeline, rateLimit, clientIp } from './_lib.js';

const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, max);

async function list() {
  const ids = await redis('ZREVRANGE', 'reviews:idx', 0, 49);
  const raws = ids.length ? await redis('HMGET', 'reviews', ...ids) : [];
  const items = raws.filter(Boolean).map((r) => JSON.parse(r));
  const [count, sum] = await Promise.all([redis('ZCARD', 'reviews:idx'), redis('GET', 'reviews:sum')]);
  return { items, count: Number(count) || 0, average: count ? Math.round((Number(sum) / count) * 10) / 10 : 0 };
}

export async function reviewsHandler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Vercel-CDN-Cache-Control', 'max-age=5');
    return send(res, 200, await list(), { 'Cache-Control': 'no-cache' });
  }
  requireAppHeader(req);
  if (req.method === 'DELETE') {
    await requireSession(req, 'admin');
    const id = String(queryParam(req, 'id') || '');
    const raw = await redis('HGET', 'reviews', id);
    if (!raw) throw new HttpError(404, 'Recensionen finns inte.');
    await pipeline([['HDEL', 'reviews', id], ['ZREM', 'reviews:idx', id], ['INCRBY', 'reviews:sum', -JSON.parse(raw).rating]]);
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Metoden stöds inte.');
  const b = await readBody(req, 5000);
  // Fältet "website" syns inte för människor. Fyller någon i det är det en spambot.
  if (b.website) return send(res, 200, { ok: true });
  const name = clean(b.name, 40), text = clean(b.text, 600), rating = Math.round(Number(b.rating));
  if (!name) throw new HttpError(400, 'Skriv ditt namn.');
  if (text.length < 5) throw new HttpError(400, 'Skriv lite mer i recensionen.');
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Välj 1 till 5 stjärnor.');
  await rateLimit('rl:review:' + clientIp(req), 3, 3600, 'Du har skickat flera recensioner nyss. Försök igen om en stund.');
  const item = { id: crypto.randomBytes(6).toString('hex'), name, text, rating, createdAt: Date.now() };
  await pipeline([['HSET', 'reviews', item.id, JSON.stringify(item)], ['ZADD', 'reviews:idx', item.createdAt, item.id], ['INCRBY', 'reviews:sum', rating]]);
  return send(res, 200, { ok: true, item });
}
