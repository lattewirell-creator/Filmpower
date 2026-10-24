import {
  handle, send, queryParam, readerSession, requireSession, requireAppHeader, actorId, pipeline, HttpError, redis, withStats, withAuthors, usernameKey, affKey, orgInfo,
} from './_lib.js';

const MAX_LIST = 200;

// Profiler: en enskild profil med inlägg, listan över alla medlemmar, och att följa konton.
// Följa sparas i två mängder: following:<den som följer> och followers:<kontot som följs>.
export default handle(async (req, res) => {
  const key = usernameKey(queryParam(req, 'u'));

  if (req.method === 'POST') {
    requireAppHeader(req);
    const s = await requireSession(req);
    const action = queryParam(req, 'action');
    if (action !== 'follow' && action !== 'unfollow') throw new HttpError(400, 'Okänd åtgärd.');
    if (!key) throw new HttpError(400, 'Vem vill du följa?');
    if (key === s.user || (key === 'filmpower' && !s.user && !s.code)) throw new HttpError(400, 'Du kan inte följa dig själv.');
    if (key !== 'filmpower') {
      const raw = await redis('HGET', 'users', key);
      if (!raw || JSON.parse(raw).status !== 'active') throw new HttpError(404, 'Kontot finns inte.');
    }
    const a = actorId(s), on = action === 'follow';
    const [, , followers] = await pipeline([
      [on ? 'SADD' : 'SREM', 'following:' + a, key],
      [on ? 'SADD' : 'SREM', 'followers:' + key, a],
      ['SCARD', 'followers:' + key],
    ]);
    return send(res, 200, { following: on, followers: Number(followers) || 0 });
  }

  if (req.method !== 'GET') throw new HttpError(405, 'Metoden stöds inte.');
  const s = await readerSession(req);

  // Vilka konton den inloggade följer.
  if (queryParam(req, 'following')) {
    return send(res, 200, { following: s.guest ? [] : await redis('SMEMBERS', 'following:' + actorId(s)) });
  }

  // Utan användarnamn: lista alla godkända medlemmar, Film Power först.
  if (!key) {
    const flat = await redis('HGETALL', 'users');
    const all = [];
    for (let i = 0; i < flat.length; i += 2) all.push([flat[i], JSON.parse(flat[i + 1])]);
    const orgs = await orgInfo(all.map(([, u]) => affKey(u)));
    const members = [];
    for (const [k, u] of all) {
      if (u.status !== 'active') continue;
      members.push({
        name: u.displayName || u.username, username: u.username, avatar: u.avatar || '',
        verified: Boolean(u.verified), role: u.role === 'admin' ? 'admin' : 'member', isMe: k === s.user, bio: u.bio || '', affiliate: orgs.get(affKey(u)) || null,
      });
    }
    members.sort((a, b) => (b.verified - a.verified) || a.name.localeCompare(b.name, 'sv'));
    members.unshift({ name: 'Film Power', username: 'filmpower', avatar: '', verified: true, role: 'admin', brand: true, isMe: false });
    return send(res, 200, { members });
  }

  let profile;
  if (key === 'filmpower') {
    profile = { brand: true, name: 'Film Power', username: 'filmpower', avatar: '', verified: true, role: 'admin', createdAt: null, bio: 'Film studio för kortfilm och indieproduktioner. Vi får bilder att röra sig.', authorKey: '' };
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
      bio: u.bio || '',
      banner: u.banner || '',
      affiliate: (await orgInfo([affKey(u)])).get(affKey(u)) || null,
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

  // Konton som är anslutna till den här profilen (Film Power eller ett annat konto).
  const orgKey = profile.brand ? 'filmpower' : key;
  const self = { username: profile.username, name: profile.name, avatar: profile.avatar, brand: profile.brand };
  const flat = await redis('HGETALL', 'users');
  const affiliates = [];
  for (let i = 0; i < flat.length; i += 2) {
    const u = JSON.parse(flat[i + 1]);
    if (u.status === 'active' && affKey(u) === orgKey) {
      affiliates.push({ name: u.displayName || u.username, username: u.username, avatar: u.avatar || '', verified: Boolean(u.verified), bio: u.bio || '', affiliate: self });
    }
  }
  affiliates.sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  // Följare och vilka kontot själv följer. Film Power följer som admin.
  const selfActor = profile.brand ? 'admin' : 'u:' + key;
  const [followers, following, isFollowing] = await pipeline([
    ['SCARD', 'followers:' + orgKey],
    ['SCARD', 'following:' + selfActor],
    ['SISMEMBER', 'followers:' + orgKey, s.guest ? 'guest' : actorId(s)],
  ]);

  const { authorKey, ...pub } = profile;
  send(res, 200, {
    profile: { ...pub, isMe: Boolean(authorKey && authorKey === s.user), followers: Number(followers) || 0, following: Number(following) || 0, isFollowing: !s.guest && Boolean(isFollowing) },
    items,
    affiliates,
  });
});
