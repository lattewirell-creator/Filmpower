// Det sociala runt profilerna, som på Twitter: blockera, tysta, anmäla, svar, följarlistor och direktmeddelanden.
//
// Nycklar: ett konto heter sitt användarnamn, Film Power (adminkoden) heter "filmpower".
// Varje konto har en aktör (som i actorId): "u:namn" för konton och "admin" för Film Power.
//   blocked:<aktör>   mängd med nycklar som aktören har blockerat
//   muted:<aktör>     mängd med nycklar som aktören har tystat
//   replies:<aktör>   sorterad mängd med "inlägg:kommentar" som aktören har skrivit
//   dm:<a>|<b>        lista med meddelanden mellan två nycklar (nyast först)
//   dms:<nyckel>      sorterad mängd med de nycklar man har pratat med, efter senaste meddelande
//   dmunread:<nyckel> hash med antal olästa per avsändare
import crypto from 'node:crypto';
import { redis, pipeline, actorId, HttpError, rateLimit, affKey, orgInfo } from './_lib.js';

export const keyActor = (key) => (key === 'filmpower' ? 'admin' : 'u:' + key);

// Den inloggades nyckel, eller null för besökare och den som loggat in med kod (de har ingen profil).
export function myKey(s) {
  if (!s || s.guest) return null;
  if (s.user) return s.user;
  if (s.code) return null;
  return 'filmpower';
}
// Det som står i andras blockeringslistor för den inloggade.
const myIdent = (s) => myKey(s) || actorId(s);

export async function accountExists(key) {
  if (key === 'filmpower') return true;
  const raw = await redis('HGET', 'users', key);
  return Boolean(raw && JSON.parse(raw).status === 'active');
}

// Har någon av de två blockerat den andra?
export async function blockedBetween(s, key) {
  const [mine, theirs] = await pipeline([
    ['SISMEMBER', 'blocked:' + actorId(s), key],
    ['SISMEMBER', 'blocked:' + keyActor(key), myIdent(s)],
  ]);
  return { blockedByMe: Boolean(mine), blocksMe: Boolean(theirs) };
}

// Relationen mellan den inloggade och en profil.
export async function relation(s, key) {
  if (s.guest) return { blockedByMe: false, blocksMe: false, mutedByMe: false, followsYou: false };
  const me = myKey(s);
  const [mine, theirs, muted, follows] = await pipeline([
    ['SISMEMBER', 'blocked:' + actorId(s), key],
    ['SISMEMBER', 'blocked:' + keyActor(key), myIdent(s)],
    ['SISMEMBER', 'muted:' + actorId(s), key],
    me ? ['SISMEMBER', 'following:' + keyActor(key), me] : ['EXISTS', 'nothing'],
  ]);
  return { blockedByMe: Boolean(mine), blocksMe: Boolean(theirs), mutedByMe: Boolean(muted), followsYou: Boolean(me && follows) };
}

export async function setBlock(s, key, on) {
  const a = actorId(s), me = myKey(s);
  const cmds = [[on ? 'SADD' : 'SREM', 'blocked:' + a, key]];
  // Blockering tar bort följandet åt båda hållen, som på Twitter.
  if (on) {
    cmds.push(['SREM', 'following:' + a, key], ['SREM', 'followers:' + key, a]);
    if (me) cmds.push(['SREM', 'following:' + keyActor(key), me], ['SREM', 'followers:' + me, keyActor(key)]);
  }
  await pipeline(cmds);
}

export const setMute = (s, key, on) => redis(on ? 'SADD' : 'SREM', 'muted:' + actorId(s), key);

export async function report(s, key, reason, label) {
  const r = { id: crypto.randomBytes(5).toString('hex'), target: key, reason: String(reason || '').trim().slice(0, 300), by: label, byKey: myKey(s) || '', at: Date.now() };
  await pipeline([['LPUSH', 'reports', JSON.stringify(r)], ['LTRIM', 'reports', 0, 199]]);
}

// ---------- Svar (kommentarer) per konto ----------

export const replyActor = (actor) => (actor === 'admin' || actor.startsWith('u:') ? actor : null);

// Kommentarer skrivna innan svar började sparas per konto läggs in en gång.
async function backfillReplies() {
  if (await redis('GET', 'replies:indexed')) return;
  const ids = await redis('ZRANGE', 'news:idx', 0, -1);
  const cmds = [];
  for (const id of ids) {
    const flat = await redis('HGETALL', 'comments:' + id);
    for (let i = 0; i < flat.length; i += 2) {
      const c = JSON.parse(flat[i + 1]);
      if (!c.anon && replyActor(c.actor)) cmds.push(['ZADD', 'replies:' + c.actor, c.createdAt, id + ':' + c.id]);
    }
  }
  for (let i = 0; i < cmds.length; i += 100) await pipeline(cmds.slice(i, i + 100));
  await redis('SET', 'replies:indexed', '1');
}

export async function repliesOf(key) {
  await backfillReplies();
  const refs = await redis('ZREVRANGE', 'replies:' + keyActor(key), 0, 49);
  if (!refs.length) return [];
  const pairs = refs.map((r) => r.split(':'));
  const res = await pipeline(pairs.flatMap(([pid, cid]) => [['HGET', 'news', pid], ['HGET', 'comments:' + pid, cid]]));
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    const post = res[2 * i] && JSON.parse(res[2 * i]), c = res[2 * i + 1] && JSON.parse(res[2 * i + 1]);
    if (!post || !c || c.anon) continue;
    out.push({ postId: post.id, postTitle: post.title || (post.body || '').slice(0, 60) + ((post.body || '').length > 60 ? '…' : ''), postAuthorKey: post.authorKey || 'filmpower', id: c.id, text: c.text, createdAt: c.createdAt });
  }
  return out;
}

// ---------- Följarlistor ----------

export async function people(keys, s) {
  keys = [...new Set(keys)].slice(0, 300);
  const userKeys = keys.filter((k) => k !== 'filmpower');
  const rows = userKeys.length ? await redis('HMGET', 'users', ...userKeys) : [];
  const accounts = new Map();
  rows.forEach((r, i) => { if (r) { const u = JSON.parse(r); if (u.status === 'active') accounts.set(userKeys[i], u); } });
  const orgs = await orgInfo([...accounts.values()].map(affKey));
  const me = myKey(s);
  const list = keys.filter((k) => k === 'filmpower' || accounts.has(k));
  const follows = me ? await pipeline(list.map((k) => ['SISMEMBER', 'following:' + keyActor(k), me])) : [];
  return list.map((k, i) => {
    const base = k === 'filmpower'
      ? { name: 'Film Power', username: 'filmpower', avatar: '', verified: true, brand: true, bio: 'Film studio för kortfilm och indieproduktioner.' }
      : (({ displayName, username, avatar, verified, bio }) => ({ name: displayName || username, username, avatar: avatar || '', verified: Boolean(verified), bio: bio || '', affiliate: orgs.get(affKey(accounts.get(k))) || null }))(accounts.get(k));
    return { ...base, followsYou: Boolean(follows[i]), isMe: k === me };
  });
}

export async function followList(key, which, s) {
  if (which === 'following') return { people: await people(await redis('SMEMBERS', 'following:' + keyActor(key)), s), others: 0 };
  const actors = await redis('SMEMBERS', 'followers:' + key);
  const keys = actors.map((a) => (a === 'admin' ? 'filmpower' : a.startsWith('u:') ? a.slice(2) : null)).filter(Boolean);
  // De som loggat in med kod har ingen profil att visa, men räknas.
  return { people: await people(keys, s), others: actors.filter((a) => a.startsWith('c:')).length };
}

// ---------- Direktmeddelanden ----------

const pairKey = (a, b) => 'dm:' + [a, b].sort().join('|');

function needDm(s) {
  const me = myKey(s);
  if (!me) throw new HttpError(403, 'Skapa ett eget konto för att skicka meddelanden.');
  return me;
}

export async function unreadTotal(s) {
  const me = myKey(s);
  if (!me) return 0;
  const vals = await redis('HVALS', 'dmunread:' + me);
  return vals.reduce((t, v) => t + (Number(v) || 0), 0);
}

export async function conversations(s) {
  const me = needDm(s);
  const partners = await redis('ZREVRANGE', 'dms:' + me, 0, 49);
  if (!partners.length) return [];
  const res = await pipeline(partners.flatMap((p) => [['LINDEX', pairKey(me, p), 0], ['HGET', 'dmunread:' + me, p]]));
  const who = new Map((await people(partners, s)).map((p) => [p.username.toLowerCase(), p]));
  return partners.map((p, i) => {
    const last = res[2 * i] ? JSON.parse(res[2 * i]) : null;
    return { with: who.get(p) || { name: '@' + p, username: p, avatar: '', verified: false }, last: last && { text: last.text, at: last.at, mine: last.from === me }, unread: Number(res[2 * i + 1]) || 0 };
  }).filter((c) => c.last);
}

// Får den inloggade skriva till kontot? Kontot kan ha valt att bara ta emot från dem det följer, eller ingen.
export async function dmAllowed(s, key) {
  const me = myKey(s);
  if (!me || key === me) return false;
  const rel = await blockedBetween(s, key);
  if (rel.blockedByMe || rel.blocksMe) return false;
  if (key === 'filmpower') return true;
  const u = JSON.parse((await redis('HGET', 'users', key)) || 'null');
  if (!u || u.status !== 'active') return false;
  const rule = u.dmFrom || 'all';
  if (rule === 'all') return true;
  // Den som redan fått ett meddelande från kontot får alltid svara.
  if (await redis('ZSCORE', 'dms:' + me, key) && (await redis('LRANGE', pairKey(me, key), 0, 49)).some((r) => JSON.parse(r).from === key)) return true;
  if (rule === 'none') return false;
  return Boolean(await redis('SISMEMBER', 'following:' + keyActor(key), me));
}

export async function thread(s, key) {
  const me = needDm(s);
  const [raws] = await pipeline([['LRANGE', pairKey(me, key), 0, 199], ['HDEL', 'dmunread:' + me, key]]);
  const [partner] = await people([key], s);
  const rel = await blockedBetween(s, key);
  return {
    with: partner || null,
    canSend: Boolean(partner) && (await dmAllowed(s, key)),
    closed: Boolean(partner) && !rel.blockedByMe && !rel.blocksMe && !(await dmAllowed(s, key)),
    blockedByMe: rel.blockedByMe,
    messages: raws.map((r) => JSON.parse(r)).reverse().map((m) => ({ id: m.id, text: m.text, at: m.at, mine: m.from === me })),
  };
}

export async function sendDm(s, key, text) {
  const me = needDm(s);
  text = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  if (!text) throw new HttpError(400, 'Skriv något först.');
  if (key === me) throw new HttpError(400, 'Du kan inte skicka meddelanden till dig själv.');
  if (!(await accountExists(key))) throw new HttpError(404, 'Kontot finns inte.');
  const rel = await blockedBetween(s, key);
  if (rel.blockedByMe) throw new HttpError(403, 'Du har blockerat det här kontot. Avblockera för att skicka meddelanden.');
  if (rel.blocksMe) throw new HttpError(403, 'Du kan inte skicka meddelanden till det här kontot.');
  if (!(await dmAllowed(s, key))) throw new HttpError(403, 'Kontot tar bara emot meddelanden från vissa personer.');
  await rateLimit('rl:dm:' + me, 40, 600, 'Du har skickat många meddelanden på kort tid. Vänta några minuter.');
  const m = { id: crypto.randomBytes(6).toString('hex'), from: me, text, at: Date.now() };
  const pk = pairKey(me, key);
  await pipeline([
    ['LPUSH', pk, JSON.stringify(m)], ['LTRIM', pk, 0, 499],
    ['ZADD', 'dms:' + me, m.at, key], ['ZADD', 'dms:' + key, m.at, me],
    ['HINCRBY', 'dmunread:' + key, me, 1],
  ]);
  return { id: m.id, text: m.text, at: m.at, mine: true };
}

// ---------- Notiser ----------
// notif:<nyckel> är en lista med det senaste som hänt kontot (nyast först), notifunread:<nyckel> antalet olästa.
// Typer: like, repost, reply, follow, mention, quote.

export async function notify(s, target, type, data = {}) {
  target = String(target || '').toLowerCase();
  const me = myKey(s);
  if (!target || target === me || data.anon) return;
  // Den som blockerat eller tystat avsändaren får inga notiser från den.
  const ident = me || actorId(s);
  const [blocked, muted, exists] = await pipeline([
    ['SISMEMBER', 'blocked:' + keyActor(target), ident],
    ['SISMEMBER', 'muted:' + keyActor(target), ident],
    target === 'filmpower' ? ['EXISTS', 'nothing'] : ['HEXISTS', 'users', target],
  ]);
  if (blocked || muted || (target !== 'filmpower' && !exists)) return;
  const n = { id: crypto.randomBytes(5).toString('hex'), type, by: me || '', byName: s.label || 'Någon', at: Date.now(), postId: data.postId || '', text: String(data.text || '').slice(0, 140) };
  await pipeline([['LPUSH', 'notif:' + target, JSON.stringify(n)], ['LTRIM', 'notif:' + target, 0, 99], ['INCR', 'notifunread:' + target]]);
}

// @-taggar i en text, som användarnamn (gemener), utan dubbletter. @ceo betyder Film Power.
export function mentionsIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9_.-]{3,20})/g)) {
    const k = m[2].replace(/[.-]+$/, '').toLowerCase();
    out.add(k === 'ceo' ? 'filmpower' : k);
  }
  return [...out].slice(0, 10);
}

export async function notifUnread(s) {
  const me = myKey(s);
  return me ? Number(await redis('GET', 'notifunread:' + me)) || 0 : 0;
}

export async function notifications(s) {
  const me = myKey(s);
  if (!me) throw new HttpError(403, 'Skapa ett eget konto för att få notiser.');
  const [raws] = await pipeline([['LRANGE', 'notif:' + me, 0, 99], ['SET', 'notifunread:' + me, '0']]);
  const list = raws.map((r) => JSON.parse(r));
  const who = new Map((await people(list.map((n) => n.by).filter(Boolean), s)).map((p) => [p.username.toLowerCase(), p]));
  const posts = [...new Set(list.map((n) => n.postId).filter(Boolean))];
  const raw = posts.length ? await redis('HMGET', 'news', ...posts) : [];
  const label = new Map(posts.map((id, i) => {
    const p = raw[i] && JSON.parse(raw[i]);
    return [id, p ? p.title || (p.body || '').slice(0, 80) : ''];
  }));
  return list.map((n) => ({ ...n, who: who.get(n.by) || null, postLabel: n.postId ? label.get(n.postId) || '' : '' }));
}
