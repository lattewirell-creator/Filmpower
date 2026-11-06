// Notiser på datorn och mobilen (Web Push), även när Film Power inte är öppen.
// Nycklarna (VAPID) skapas automatiskt första gången och sparas i databasen, så inget behöver
// ställas in i Vercel. Varje konto kan ha upp till 10 enheter.
//   push:vapid        { publicKey, privateKey }
//   push:<nyckel>     hash: enhets-id -> prenumeration (JSON)
import crypto from 'node:crypto';
import * as webpush from 'web-push';
import { redis, HttpError } from './_lib.js';

const SUBJECT = 'https://filmpower.vercel.app';
let keys = null;

async function vapid() {
  if (keys) return keys;
  let raw = await redis('GET', 'push:vapid');
  if (!raw) {
    const k = webpush.generateVAPIDKeys();
    await redis('SET', 'push:vapid', JSON.stringify(k), 'NX');
    raw = await redis('GET', 'push:vapid');
  }
  keys = JSON.parse(raw);
  return keys;
}

export async function publicKey() {
  return (await vapid()).publicKey;
}

const subId = (endpoint) => crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 16);

export async function addSub(me, sub) {
  if (!me) throw new HttpError(403, 'Skapa ett eget konto för att få notiser på datorn.');
  const endpoint = String((sub && sub.endpoint) || '');
  const k = (sub && sub.keys) || {};
  if (!/^https:\/\/[^\s]{10,800}$/.test(endpoint) || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) {
    throw new HttpError(400, 'Notiserna kunde inte slås på i den här webbläsaren.');
  }
  const key = 'push:' + me;
  const all = await redis('HKEYS', key);
  const id = subId(endpoint);
  if (!all.includes(id) && all.length >= 10) await redis('HDEL', key, all[0]);
  await redis('HSET', key, id, JSON.stringify({ endpoint, keys: { p256dh: k.p256dh, auth: k.auth }, at: Date.now() }));
}

export async function removeSub(me, endpoint) {
  if (me && endpoint) await redis('HDEL', 'push:' + me, subId(String(endpoint)));
}

export async function hasSub(me, endpoint) {
  return Boolean(me && endpoint && (await redis('HEXISTS', 'push:' + me, subId(String(endpoint)))));
}

// Skickar till alla kontots enheter. Misslyckas en enhet stör det inte resten, och enheter som
// inte finns längre (avinstallerad app, återkallat tillstånd) tas bort.
export async function pushTo(me, payload) {
  try {
    const flat = await redis('HGETALL', 'push:' + me);
    if (!flat.length) return;
    const k = await vapid();
    const body = JSON.stringify(payload);
    const jobs = [];
    for (let i = 0; i < flat.length; i += 2) {
      const id = flat[i];
      let sub;
      try { sub = JSON.parse(flat[i + 1]); } catch { continue; }
      jobs.push(Promise.race([
        webpush.sendNotification(sub, body, { TTL: 86400, urgency: 'normal', vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]).catch((err) => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) return redis('HDEL', 'push:' + me, id);
        console.error('Push misslyckades:', err && (err.statusCode || err.message));
      }));
    }
    await Promise.all(jobs);
  } catch (err) {
    console.error('Push:', err.message);
  }
}
