import {
  handle, send, queryParam, requireSession, HttpError, redis, withStats, withAuthors, usernameKey,
} from './_lib.js';

const MAX_LIST = 200;

// Offentlig profil för en inloggad läsare: Film Power eller ett godkänt konto, med personens inlägg.
export default handle(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Använd GET.');
  const s = await requireSession(req);
  const key = usernameKey(queryParam(req, 'u'));
  if (!key) throw new HttpError(400, 'Profil saknas.');

  let profile;
  if (key === 'filmpower') {
    profile = { brand: true, name: 'Film Power', username: 'filmpower', avatar: '', verified: true, role: 'admin', createdAt: null, authorKey: '' };
  } else {
    const raw = await redis('HGET', 'users', key);
    const u = raw ? JSON.parse(raw) : null;
    if (!u || u.status !== 'active') throw new HttpError(404, 'Profilen finns inte.');
    profile = {
      brand: false,
      name: u.displayName || u.username,
      username: u.username,
      avatar: u.avatar || '',
      verified: Boolean(u.verified),
      role: u.role === 'admin' ? 'admin' : 'member',
      createdAt: u.createdAt,
      authorKey: key,
    };
  }

  const ids = await redis('ZREVRANGE', 'news:idx', 0, MAX_LIST - 1);
  let items = [];
  if (ids.length) {
    const raws = await redis('HMGET', 'news', ...ids);
    items = raws.filter(Boolean).map((r) => JSON.parse(r)).filter((i) => (i.authorKey || '') === profile.authorKey);
    items = await withStats(await withAuthors(items, s), s);
  }

  const { authorKey, ...pub } = profile;
  send(res, 200, {
    profile: { ...pub, isMe: Boolean(authorKey && authorKey === s.user) },
    items,
  });
});
