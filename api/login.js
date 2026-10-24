import {
  handle, send, readBody, requireAppHeader, HttpError, dbReady, redis, pipeline,
  normalizeCode, hashCode, safeEqual, sessionCookie, clientIp,
} from './_lib.js';

const MAX_ATTEMPTS = 10; // per IP och kvart

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Använd POST.');
  requireAppHeader(req);

  const adminCode = process.env.ADMIN_CODE;
  if (!adminCode) throw new HttpError(503, 'ADMIN_CODE är inte inställd i Vercel än.');

  const { code } = await readBody(req);
  const entered = normalizeCode(code);
  if (!entered) throw new HttpError(400, 'Skriv in din kod.');

  if (dbReady()) {
    const key = 'rl:login:' + clientIp(req);
    const [attempts] = await pipeline([['INCR', key], ['EXPIRE', key, 900, 'NX']]);
    if (attempts > MAX_ATTEMPTS) throw new HttpError(429, 'För många försök. Vänta en kvart och prova igen.');
  }

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
