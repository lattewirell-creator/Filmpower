import {
  handle, send, readBody, requireAppHeader, HttpError, dbReady, redis, pipeline,
  normalizeCode, hashCode, safeEqual, sessionCookie, clientIp,
  usernameKey, hashPassword, checkPassword,
} from './_lib.js';

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
  // Inloggning med användarnamn och lösenord
  if (b.username !== undefined) {
    if (!dbReady()) throw new HttpError(503, 'Databasen är inte kopplad än.');
    const key = usernameKey(b.username);
    const password = String(b.password || '');
    if (!key || !password) throw new HttpError(400, 'Fyll i användarnamn och lösenord.');

    const raw = await redis('HGET', 'users', key);
    const user = raw ? JSON.parse(raw) : null;
    // Räkna hash även när kontot saknas, så att svarstiden inte avslöjar vilka namn som finns.
    const ok = user ? await checkPassword(password, user.salt, user.hash) : (await hashPassword(password), false);
    if (!ok) throw new HttpError(401, 'Fel användarnamn eller lösenord.');
    if (user.status === 'pending') throw new HttpError(403, 'Ditt konto väntar på att admin godkänner det.');
    if (user.status === 'blocked') throw new HttpError(403, 'Ditt konto är spärrat. Kontakta Film Power.');

    const role = user.role === 'admin' ? 'admin' : 'member';
    const label = user.displayName || user.username;
    return send(res, 200, { role, label }, {
      'Set-Cookie': sessionCookie(req, { role, label, user: key }),
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

  // Från Admin-fliken godtas bara adminkoden.
  if (b.as === 'admin') throw new HttpError(401, 'Det är inte adminkoden. Är du medlem? Välj Medlem ovanför.');

  if (dbReady()) {
    const hash = hashCode(entered);
    const raw = await redis('HGET', 'codes', hash);
    if (raw) {
      const info = JSON.parse(raw);
      return send(res, 200, { role: 'member', label: info.label }, {
        'Set-Cookie': sessionCookie(req, { role: 'member', label: info.label, code: hash }),
      });
    }
  }

  throw new HttpError(401, 'Koden stämmer inte. Kolla stavningen och försök igen.');
}
