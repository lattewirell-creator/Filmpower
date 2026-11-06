// Kön för nyhetskontot film://power: den dagliga körningen väljer ut nyheterna och lägger dem här
// med slumpmässiga tider under dagen. publishDue() publicerar det som är dags när någon har
// sajten öppen (flödet och livekollen anropar den), så att inläggen kommer ett och ett.
//   bot:queue   sorterad mängd: inläggs-id -> tid det ska ut
//   bot:queued  hash: inläggs-id -> inlägget (JSON)
import { redis, pipeline } from './_lib.js';
import { notify } from './_social.js';
import { NEWS_KEY, NEWS_NAME } from './_newsaccount.js';

let lastCheck = 0;

// Slumpmässiga tider från om en kvart till om ungefär 14 timmar, i stigande ordning.
export function randomTimes(count, now = Date.now()) {
  const start = now + 10 * 60 * 1000, end = now + 14 * 3600 * 1000;
  return Array.from({ length: count }, () => start + Math.random() * (end - start)).sort((a, b) => a - b).map(Math.round);
}

export async function queuePosts(items) {
  if (!items.length) return;
  const cmds = [];
  for (const item of items) cmds.push(['HSET', 'bot:queued', item.id, JSON.stringify(item)], ['ZADD', 'bot:queue', item.createdAt, item.id]);
  await pipeline(cmds);
}

export async function queueCount() {
  return Number(await redis('ZCARD', 'bot:queue')) || 0;
}

export async function publishDue() {
  if (Date.now() - lastCheck < 15000) return 0;
  lastCheck = Date.now();
  const due = await redis('ZRANGEBYSCORE', 'bot:queue', 0, Date.now());
  let published = 0;
  for (const id of due) {
    // ZREM lyckas bara för en server åt gången, så samma inlägg publiceras aldrig två gånger.
    if (!(await redis('ZREM', 'bot:queue', id))) continue;
    const raw = await redis('HGET', 'bot:queued', id);
    await redis('HDEL', 'bot:queued', id);
    if (!raw) continue;
    const item = JSON.parse(raw);
    item.createdAt = Date.now();
    await pipeline([['HSET', 'news', item.id, JSON.stringify(item)], ['ZADD', 'news:idx', item.createdAt, item.id]]);
    published++;
    // De som slagit på klockan på nyhetskontot får en notis.
    const bells = (await redis('SMEMBERS', 'postbell:' + NEWS_KEY)).slice(0, 100);
    const as = { user: NEWS_KEY, label: NEWS_NAME, role: 'admin' };
    await Promise.all(bells.map((k) => notify(as, k, 'post', { postId: item.id, text: item.title || item.body }).catch(() => {})));
  }
  return published;
}
