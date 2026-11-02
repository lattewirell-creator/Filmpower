import {
  handle, send, readBody, queryParam, readerSession, requireSession, requireAppHeader, actorId, pipeline, HttpError, redis, withStats, withAuthors, usernameKey, affKey, orgInfo, rateLimit,
} from './_lib.js';
import {
  keyActor, myKey, accountExists, relation, dmAllowed, people, notify, notifications, notifUnread, blockedBetween, setBlock, setMute, report, repliesOf, followList, conversations, thread, sendDm, unreadTotal,
} from './_social.js';

const MAX_LIST = 200;
// "Drivs av" på företagskonton. Film Power har det här som standard tills admin ändrar det.
const DEFAULT_RUN_BY = { filmpower: ['lattewirell', 'melvin'] };

async function runByOf(key) {
  const raw = await redis('HGET', 'runby', key);
  const names = raw ? JSON.parse(raw) : DEFAULT_RUN_BY[key] || [];
  if (!names.length) return [];
  const rows = await redis('HMGET', 'users', ...names);
  return names.map((n, i) => {
    const u = rows[i] ? JSON.parse(rows[i]) : null;
    if (!u || u.status !== 'active') return { username: n, name: '@' + n, avatar: '', verified: false, exists: false };
    return { username: u.username, name: u.displayName || u.username, avatar: u.avatar || '', verified: Boolean(u.verified), exists: true };
  });
}

// Profiler: en enskild profil med inlägg, listan över alla medlemmar, och att följa konton.
// Följa sparas i två mängder: following:<den som följer> och followers:<kontot som följs>.
export default handle(async (req, res) => {
  const key = usernameKey(queryParam(req, 'u'));

  if (req.method === 'POST') {
    requireAppHeader(req);
    const s = await requireSession(req);
    const action = queryParam(req, 'action');

    // Admin ändrar vilka som driver ett konto. Tom lista tar bort raden.
    if (action === 'runby') {
      if (s.role !== 'admin') throw new HttpError(403, 'Bara admin kan ändra det här.');
      if (!key) throw new HttpError(400, 'Vilket konto gäller det?');
      const b = await readBody(req);
      const names = [...new Set((Array.isArray(b.runBy) ? b.runBy : []).map((n) => usernameKey(String(n).replace(/^@/, ''))).filter((n) => /^[a-z0-9_.-]{3,20}$/.test(n)))].slice(0, 10);
      await redis('HSET', 'runby', key, JSON.stringify(names));
      return send(res, 200, { runBy: await runByOf(key) });
    }

    // Direktmeddelande till kontot.
    if (action === 'dm') {
      if (!key) throw new HttpError(400, 'Vem vill du skriva till?');
      const b = await readBody(req, 10_000);
      return send(res, 201, { message: await sendDm(s, key, b.text) });
    }

    // Fäst ett eget inlägg högst upp på profilen (eller lossa det).
    if (action === 'pin') {
      const b = await readBody(req);
      const id = String(b.id || '');
      const me = myKey(s);
      if (!me) throw new HttpError(403, 'Skapa ett eget konto för att fästa inlägg på din profil.');
      if (id) {
        const raw = await redis('HGET', 'news', id);
        if (!raw || (JSON.parse(raw).authorKey || 'filmpower') !== me) throw new HttpError(403, 'Du kan bara fästa dina egna inlägg.');
      }
      if (me === 'filmpower') await redis(id ? 'SET' : 'DEL', 'profilepin:filmpower', ...(id ? [id] : []));
      else {
        const u = JSON.parse(await redis('HGET', 'users', me));
        u.pinnedPost = id;
        await redis('HSET', 'users', me, JSON.stringify(u));
      }
      return send(res, 200, { pinnedPost: id });
    }

    if (['block', 'unblock', 'mute', 'unmute', 'report'].includes(action)) {
      if (!key) throw new HttpError(400, 'Vilket konto gäller det?');
      if (key === myKey(s)) throw new HttpError(400, 'Det går inte på ditt eget konto.');
      if (!(await accountExists(key))) throw new HttpError(404, 'Kontot finns inte.');
      if (action === 'report') {
        const b = await readBody(req, 5000);
        await rateLimit('rl:report:' + actorId(s), 10, 3600, 'Du har anmält många gånger nyss. Försök igen senare.');
        await report(s, key, b.reason, s.label || 'Okänd');
        return send(res, 200, { ok: true });
      }
      if (action === 'block' || action === 'unblock') await setBlock(s, key, action === 'block');
      else await setMute(s, key, action === 'mute');
      return send(res, 200, await relation(s, key));
    }

    if (action !== 'follow' && action !== 'unfollow') throw new HttpError(400, 'Okänd åtgärd.');
    if (!key) throw new HttpError(400, 'Vem vill du följa?');
    if (action === 'follow') {
      const rel = await blockedBetween(s, key);
      if (rel.blockedByMe) throw new HttpError(403, 'Du har blockerat kontot. Avblockera först.');
      if (rel.blocksMe) throw new HttpError(403, 'Du kan inte följa det här kontot.');
    }
    if (key === s.user || (key === 'filmpower' && !s.user && !s.code)) throw new HttpError(400, 'Du kan inte följa dig själv.');
    if (key !== 'filmpower') {
      const raw = await redis('HGET', 'users', key);
      if (!raw || JSON.parse(raw).status !== 'active') throw new HttpError(404, 'Kontot finns inte.');
    }
    const a = actorId(s), on = action === 'follow';
    const [added, , followers] = await pipeline([
      [on ? 'SADD' : 'SREM', 'following:' + a, key],
      [on ? 'SADD' : 'SREM', 'followers:' + key, a],
      ['SCARD', 'followers:' + key],
    ]);
    if (on && added) await notify(s, key, 'follow');
    return send(res, 200, { following: on, followers: Number(followers) || 0 });
  }

  if (req.method !== 'GET') throw new HttpError(405, 'Metoden stöds inte.');
  const s = await readerSession(req);

  // Vilka konton den inloggade följer, har tystat och blockerat, och antal olästa meddelanden.
  if (queryParam(req, 'following')) {
    if (s.guest) return send(res, 200, { following: [], muted: [], blocked: [], unread: 0, canDm: false });
    const a = actorId(s);
    const [following, muted, blocked] = await pipeline([['SMEMBERS', 'following:' + a], ['SMEMBERS', 'muted:' + a], ['SMEMBERS', 'blocked:' + a]]);
    const me = myKey(s);
    const pinnedPost = me === 'filmpower' ? await redis('GET', 'profilepin:filmpower') : me ? (JSON.parse((await redis('HGET', 'users', me)) || '{}').pinnedPost || '') : '';
    // Det de man följer har delat vidare, till flödet Följer.
    const fk = following.slice(0, 60);
    const rp = fk.length ? await pipeline(fk.map((k) => ['ZREVRANGE', 'reposts:' + keyActor(k), 0, 9, 'WITHSCORES'])) : [];
    const names = new Map((await people(fk, s)).map((p) => [p.username.toLowerCase(), p.name]));
    const feedReposts = [];
    fk.forEach((k, i) => { const l = rp[i] || []; for (let j = 0; j < l.length; j += 2) feedReposts.push({ by: k, byName: names.get(k) || '@' + k, id: l[j], at: Number(l[j + 1]) }); });
    return send(res, 200, { following, muted, blocked, unread: await unreadTotal(s), canDm: Boolean(me), me, pinnedPost: pinnedPost || '', feedReposts, notifUnread: await notifUnread(s) });
  }

  // Notiser till den inloggade. Läses som lästa när de hämtas.
  if (queryParam(req, 'notifs')) {
    if (s.guest) throw new HttpError(401, 'Du behöver logga in.');
    return send(res, 200, { notifications: await notifications(s) });
  }

  // Direktmeddelanden: alla konversationer, eller en tråd med ett konto.
  if (queryParam(req, 'dm')) {
    if (s.guest) throw new HttpError(401, 'Du behöver logga in.');
    if (key) return send(res, 200, await thread(s, key));
    return send(res, 200, { conversations: await conversations(s), unread: await unreadTotal(s) });
  }

  // Följare eller vilka ett konto följer.
  const list = queryParam(req, 'list');
  if (key && (list === 'followers' || list === 'following')) {
    if (!(await accountExists(key))) throw new HttpError(404, 'Profilen finns inte.');
    return send(res, 200, await followList(key, list, s));
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
    profile = { brand: true, name: 'Film Power', username: 'filmpower', avatar: '', verified: true, role: 'admin', createdAt: null, bio: 'Film studio för kortfilm och indieproduktioner. Vi får bilder att röra sig.', authorKey: '', location: 'Sverige', website: 'https://filmpower.vercel.app', pinnedPost: (await redis('GET', 'profilepin:filmpower')) || '' };
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
      location: u.location || '',
      website: u.website || '',
      birthday: u.birthday || '',
      pinnedPost: u.pinnedPost || '',
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
  const rel = await relation(s, orgKey);
  // Inlägg som kontot har delat vidare visas under Inlägg, med "delade vidare".
  const rpl = await redis('ZREVRANGE', 'reposts:' + keyActor(orgKey), 0, 49, 'WITHSCORES');
  let reposts = [];
  if (rpl.length) {
    const rids = rpl.filter((_, j) => j % 2 === 0);
    const rraws = await redis('HMGET', 'news', ...rids);
    const at = new Map(rids.map((id, j) => [id, Number(rpl[2 * j + 1])]));
    reposts = (await withStats(await withAuthors(rraws.filter(Boolean).map((r) => JSON.parse(r)), s), s)).map((item) => ({ at: at.get(item.id), item }));
  }
  // Har kontot blockerat den som tittar visas varken inlägg eller svar, som på Twitter.
  const hidden = rel.blocksMe;
  send(res, 200, {
    profile: { ...pub, ...rel, dmAllowed: await dmAllowed(s, orgKey), runBy: await runByOf(orgKey), isMe: Boolean(myKey(s) && myKey(s) === orgKey), followers: Number(followers) || 0, following: Number(following) || 0, isFollowing: !s.guest && Boolean(isFollowing), posts: items.length },
    items: hidden ? [] : items,
    replies: hidden ? [] : await repliesOf(orgKey),
    reposts: hidden ? [] : reposts,
    affiliates,
  });
});
