import {
  handle, send, readBody, requireAppHeader, HttpError, dbReady, redis, rateLimit,
  clientIp, USERNAME_RE, usernameKey, hashPassword,
} from './_lib.js';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Använd POST.');
  requireAppHeader(req);
  if (!dbReady()) throw new HttpError(503, 'Databasen är inte kopplad än.');

  const b = await readBody(req);
  const display = String(b.username || '').trim();
  const key = usernameKey(display);
  const password = String(b.password || '');

  if (!USERNAME_RE.test(key)) {
    throw new HttpError(400, 'Användarnamnet ska vara 3–20 tecken: bokstäver a–z, siffror, punkt, bindestreck eller understreck.');
  }
  if (password.length < 8) throw new HttpError(400, 'Lösenordet behöver minst 8 tecken.');
  if (password.length > 200) throw new HttpError(400, 'Lösenordet är för långt.');

  await rateLimit('rl:register:' + clientIp(req), 5, 3600, 'För många nya konton härifrån. Försök igen om en timme.');

  const { salt, hash } = await hashPassword(password);
  const user = { username: display, salt, hash, status: 'pending', createdAt: Date.now() };
  const created = await redis('HSETNX', 'users', key, JSON.stringify(user));
  if (!created) throw new HttpError(409, 'Användarnamnet är upptaget. Välj ett annat.');

  send(res, 201, { ok: true });
});
