// Film Power Nyheter: ett eget konto som nyhetsboten postar som, skilt från Film Powers huvudkonto.
// Kontot skapas automatiskt första gången servern behöver det. Lösenordet sparas bara krypterat
// (salt och hash nedan), aldrig i klartext. Admin kan byta det under Konton om det behövs.
import { redis, pipeline } from './_lib.js';

export const NEWS_KEY = 'filmpowernyheter';
export const NEWS_NAME = 'Film Power Nyheter';
const LOGIN = {"salt":"4da9a269925f3d25f19dc73b13e7b208","hash":"3c8c81a8a94c86946594bc2fe340ab0d227fc8b0ef471bda001b0574535da8fb7bc9ac0518cbc4cb9ceb4d828ad256bff627b7ffc1aa0153a8268d8ce3f47d99"};
const AVATAR_ID = 'f9e75a0000000001'; // bild-id måste vara 16 hextecken
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
      verified: true,
      avatar: AVATAR_ID,
      bio: user.bio || 'Filmnyheter, premiärer och det som är nytt på bio. Varje dag, från Film Power.',
      website: user.website || 'https://filmpower.vercel.app/nyheter/',
    });
    await pipeline([['SET', 'img:' + AVATAR_ID, AVATAR], ['HSET', 'users', NEWS_KEY, JSON.stringify(user)]]);
    await moveBotPosts();
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
