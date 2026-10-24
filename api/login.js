import {
  handle, send, readBody, requireAppHeader, HttpError, dbReady, redis, rateLimit,
  normalizeCode, hashCode, safeEqual, sessionCookie, clientIp,
  usernameKey, hashPassword, checkPassword,
} from './_lib.js';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Använd POST.');
  requireAppHeader(req);

  const b = await readBody(req);
  await rateLimit('rl:login:' + clientIp(req), 10, 900, 'För många försök. Vänta en kvart och prova igen.');

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

    return send(res, 200, { role: 'member', label: user.username }, {
      'Set-Cookie': sessionCookie(req, { role: 'member', label: user.username, user: key }),
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
});
