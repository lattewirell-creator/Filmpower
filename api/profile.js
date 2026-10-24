import {
  handle, send, queryParam, requireSession, HttpError, redis, withStats, withAuthors, usernameKey,
} from './_lib.js';

const MAX_LIST = 200;

// Profiler för inloggade: en enskild profil med inlägg, eller listan över alla medlemmar.
export default handle(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Använd GET.');
  const s = await requireSession(req);
  const key = usernameKey(queryParam(req, 'u'));

  // Utan användarnamn: lista alla godkända medlemmar, Film Power först.
  if (!key) {
    const flat = await redis('HGETALL', 'users');
    const members = [];
    for (let i = 0; i < flat.length; i += 2) {
      const u = JSON.parse(flat[i + 1]);
      if (u.status !== 'active') continue;
      members.push({
        name: u.displayName || u.username, username: u.username, avatar: u.avatar || '',
        verified: Boolean(u.verified), role: u.role === 'admin' ? 'admin' : 'member', isMe: flat[i] === s.user,
      });
    }
    members.sort((a, b) => (b.verified - a.verified) || a.name.localeCompare(b.name, 'sv'));
    members.unshift({ name: 'Film Power', username: 'filmpower', avatar: '', verified: true, role: 'admin', brand: true, isMe: false });
    return send(res, 200, { members });
  }

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
