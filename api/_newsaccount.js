// Film Power Nyheter: ett eget konto som nyhetsboten postar som, skilt från Film Powers huvudkonto.
// Kontot skapas automatiskt första gången servern behöver det. Lösenordet sparas bara krypterat
// (salt och hash nedan), aldrig i klartext. Admin kan byta det under Konton om det behövs.
import { redis, pipeline } from './_lib.js';

export const NEWS_KEY = 'filmpowernyheter';
export const NEWS_NAME = 'film://power'; // skrivs som loggan, med grönt :// på sajten
const LOGIN = {"salt":"4da9a269925f3d25f19dc73b13e7b208","hash":"3c8c81a8a94c86946594bc2fe340ab0d227fc8b0ef471bda001b0574535da8fb7bc9ac0518cbc4cb9ceb4d828ad256bff627b7ffc1aa0153a8268d8ce3f47d99"};
const AVATAR_ID = 'f9e75a0000000003'; // bild-id måste vara 16 hextecken. Profilbilden är loggan f://.
const AVATAR = 'data:image/png;base64,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';

let ready = false;

export async function ensureNewsAccount() {
  if (ready) return;
  // En gång per databas: skapa kontot, sätt profilbilden och flytta nyhetsbotens äldre inlägg dit.
  const first = await redis('SET', 'seed:newsaccount:v1', String(Date.now()), 'NX');
  if (first) {
    const raw = await redis('HGET', 'users', NEWS_KEY);
    const user = raw ? JSON.parse(raw) : { createdAt: Date.now() };
    Object.assign(user, {
      username: NEWS_KEY,
      displayName: NEWS_NAME,
      salt: LOGIN.salt,
      hash: LOGIN.hash,
      status: 'active',
      role: 'admin',
      verified: true,
      avatar: AVATAR_ID,
      bio: user.bio || 'Filmnyheter, premiärer och det som är nytt på bio. Varje dag, från Film Power.',
      website: user.website || 'https://filmpower.vercel.app/nyheter/',
    });
    await pipeline([['SET', 'img:' + AVATAR_ID, AVATAR], ['HSET', 'users', NEWS_KEY, JSON.stringify(user)]]);
    await moveBotPosts();
  }
  // Kontot är admin och loggar in med användarnamn och lösenord. Körs en gång.
  if (await redis('SET', 'seed:newsaccount:admin', String(Date.now()), 'NX')) {
    const raw = await redis('HGET', 'users', NEWS_KEY);
    if (raw) {
      const user = JSON.parse(raw);
      Object.assign(user, { role: 'admin', status: 'active', verified: true, salt: LOGIN.salt, hash: LOGIN.hash });
      await redis('HSET', 'users', NEWS_KEY, JSON.stringify(user));
    }
  }
  // Namnet blir loggan film://power, även på inlägg som redan publicerats. Körs en gång.
  if (await redis('SET', 'seed:newsaccount:name2', String(Date.now()), 'NX')) {
    const raw = await redis('HGET', 'users', NEWS_KEY);
    if (raw) { const user = JSON.parse(raw); user.displayName = NEWS_NAME; await redis('HSET', 'users', NEWS_KEY, JSON.stringify(user)); }
    const flat = await redis('HGETALL', 'news');
    const cmds = [];
    for (let i = 0; i < flat.length; i += 2) {
      let item;
      try { item = JSON.parse(flat[i + 1]); } catch { continue; }
      if (item.authorKey === NEWS_KEY && item.author !== NEWS_NAME) { item.author = NEWS_NAME; cmds.push(['HSET', 'news', item.id, JSON.stringify(item)]); }
    }
    for (let i = 0; i < cmds.length; i += 50) await pipeline(cmds.slice(i, i + 50));
  }
  // Ny profilbild (loggan) för kontot som redan finns. Körs en gång.
  if (await redis('SET', 'seed:newsaccount:avatar3', String(Date.now()), 'NX')) {
    const raw = await redis('HGET', 'users', NEWS_KEY);
    if (raw) {
      const user = JSON.parse(raw);
      const old = user.avatar;
      user.avatar = AVATAR_ID;
      await pipeline([['SET', 'img:' + AVATAR_ID, AVATAR], ['HSET', 'users', NEWS_KEY, JSON.stringify(user)]]);
      if (old && old !== AVATAR_ID) await redis('DEL', 'img:' + old);
    }
  }
  ready = true;
}

// Nyheter som boten redan publicerat som Film Power flyttas till nyhetskontot.
async function moveBotPosts() {
  const flat = await redis('HGETALL', 'news');
  const cmds = [];
  for (let i = 0; i < flat.length; i += 2) {
    let item;
    try { item = JSON.parse(flat[i + 1]); } catch { continue; }
    if (!item.bot || item.authorKey) continue;
    item.authorKey = NEWS_KEY;
    item.author = NEWS_NAME;
    cmds.push(['HSET', 'news', item.id, JSON.stringify(item)]);
  }
  for (let i = 0; i < cmds.length; i += 50) await pipeline(cmds.slice(i, i + 50));
  return cmds.length;
}
