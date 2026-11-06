import {
  handle, send, readBody, requireAppHeader, HttpError, dbReady, redis, pipeline,
  normalizeCode, hashCode, safeEqual, sessionCookie, clientIp,
  usernameKey, hashPassword, checkPassword,
} from './_lib.js';
import { ensureNewsAccount, NEWS_KEY } from './_newsaccount.js';

const MAX_FAILS = 10; // misslyckade försök per IP och kvart

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Använd POST.');
  requireAppHeader(req);

  const b = await readBody(req);
  const rlKey = 'rl:login:' + clientIp(req);
  if (dbReady() && Number(await redis('GET', rlKey) || 0) >= MAX_FAILS) {
    throw new HttpError(429, 'För många felaktiga försök. Vänta en kvart och prova igen.');
  }

  try {
    await attempt(b, req, res);
  } catch (err) {
    // Bara misslyckade inloggningar räknas mot spärren.
    if (err instanceof HttpError && err.status === 401 && dbReady()) {
      await pipeline([['INCR', rlKey], ['EXPIRE', rlKey, 900, 'NX']]);
    }
    throw err;
  }
});

async function attempt(b, req, res) {
  if (b.username !== undefined && dbReady()) await ensureNewsAccount().catch(() => {});
  // Inloggning med användarnamn och lösenord
  if (b.username !== undefined) {
    if (!dbReady()) throw new HttpError(503, 'Databasen är inte kopplad än.');
    const key = usernameKey(b.username);
    const password = String(b.password || '');
    if (!key || !password) throw new HttpError(400, 'Fyll i användarnamn och lösenord.');

    // Nyhetskontot film://power loggar bara in via Admin-fliken.
    if (key === NEWS_KEY) throw new HttpError(401, 'Fel användarnamn eller lösenord.');
    const raw = await redis('HGET', 'users', key);
    const user = raw ? JSON.parse(raw) : null;
    // Adminkonton får högst 20 felaktiga försök per dygn, oavsett varifrån de kommer,
    // så att ett kort lösenord inte kan gissas fram från många datorer.
    const acctKey = 'rl:loginacct:' + key;
    if (user && user.role === 'admin' && Number(await redis('GET', acctKey) || 0) >= 20) {
      throw new HttpError(429, 'Kontot är spärrat för inloggning i ett dygn efter för många felaktiga försök.');
    }
    // Räkna hash även när kontot saknas, så att svarstiden inte avslöjar vilka namn som finns.
    const ok = user ? await checkPassword(password, user.salt, user.hash) : (await hashPassword(password), false);
    if (!ok) {
      if (user && user.role === 'admin') await pipeline([['INCR', acctKey], ['EXPIRE', acctKey, 86400, 'NX']]);
      throw new HttpError(401, 'Fel användarnamn eller lösenord.');
    }
    if (user.status === 'pending') {
      // Konton som skapades när godkännande krävdes aktiveras vid första inloggningen.
      user.status = 'active';
      await redis('HSET', 'users', key, JSON.stringify(user));
    }
    if (user.status === 'blocked') throw new HttpError(403, 'Ditt konto är spärrat. Kontakta Film Power.');

    const role = user.role === 'admin' ? 'admin' : 'member';
    const label = user.displayName || user.username;
    const anon = Boolean(b.anon);
    return send(res, 200, { role, label, verified: Boolean(user.verified), avatar: user.avatar || '', anon }, {
      'Set-Cookie': sessionCookie(req, { role, label, user: key, anon }),
    });
  }

  // Inloggning med kod (admin eller medlem)
  const adminCode = process.env.ADMIN_CODE;
  if (!adminCode) throw new HttpError(503, 'ADMIN_CODE är inte inställd i Vercel än.');

  const entered = normalizeCode(b.code);
  if (!entered) throw new HttpError(400, 'Skriv in din kod.');

  if (safeEqual(entered, normalizeCode(adminCode))) {
    return send(res, 200, { role: 'admin', label: 'Admin' }, {
      'Set-Cookie': sessionCookie(req, { role: 'admin', label: 'Admin' }),
    });
  }

  // Från Admin-fliken godtas adminkoden, och nyhetskontots lösenord (loggar in som film://power).
  if (b.as === 'admin') {
    if (dbReady()) {
      await ensureNewsAccount().catch(() => {});
      const raw = await redis('HGET', 'users', NEWS_KEY);
      const user = raw ? JSON.parse(raw) : null;
      const acctKey = 'rl:loginacct:' + NEWS_KEY;
      if (user && user.role === 'admin' && user.status === 'active' && Number(await redis('GET', acctKey) || 0) < 20) {
        if (await checkPassword(String(b.code || '').trim(), user.salt, user.hash)) {
          const label = user.displayName || user.username;
          return send(res, 200, { role: 'admin', label, verified: Boolean(user.verified), avatar: user.avatar || '', anon: false }, {
            'Set-Cookie': sessionCookie(req, { role: 'admin', label, user: NEWS_KEY, anon: false }),
          });
        }
        await pipeline([['INCR', acctKey], ['EXPIRE', acctKey, 86400, 'NX']]);
      }
    }
    throw new HttpError(401, 'Det är inte adminkoden. Är du medlem? Välj Medlem ovanför.');
  }

  if (dbReady()) {
    const hash = hashCode(entered);
    const raw = await redis('HGET', 'codes', hash);
    if (raw) {
      const info = JSON.parse(raw);
      const anon = Boolean(b.anon);
      return send(res, 200, { role: 'member', label: info.label, anon }, {
        'Set-Cookie': sessionCookie(req, { role: 'member', label: info.label, code: hash, anon }),
      });
    }
  }

  throw new HttpError(401, 'Koden stämmer inte. Kolla stavningen och försök igen.');
}
