import {
  handle, send, readBody, requireAppHeader, requireSession, HttpError, redis, pipeline,
  actorId, hashPassword, checkPassword,
} from './_lib.js';

// Den inloggades egen profil: visa, byta visningsnamn och byta lösenord.
export default handle(async (req, res) => {
  const s = await requireSession(req);
  const a = actorId(s);
  const raw = s.user ? await redis('HGET', 'users', s.user) : null;
  const u = raw ? JSON.parse(raw) : null;

  if (req.method === 'GET') {
    const [liked, saved] = await pipeline([['SCARD', 'liked:' + a], ['SCARD', 'saved:' + a]]);
    return send(res, 200, {
      kind: u ? 'account' : s.code ? 'code' : 'admin',
      username: u ? u.username : null,
      displayName: u ? u.displayName || u.username : s.label,
      role: s.role,
      verified: Boolean(u && u.verified),
      createdAt: u ? u.createdAt : null,
      liked: Number(liked) || 0,
      saved: Number(saved) || 0,
    });
  }

  requireAppHeader(req);
  if (req.method !== 'PATCH') throw new HttpError(405, 'Metoden stöds inte.');
  if (!u) throw new HttpError(400, 'Bara den som har ett eget konto kan ändra namn och lösenord.');

  const b = await readBody(req);

  if (b.displayName !== undefined) {
    const name = String(b.displayName).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 30) throw new HttpError(400, 'Namnet ska vara 2–30 tecken.');
    u.displayName = name;
  }

  if (b.newPassword !== undefined) {
    const ok = await checkPassword(String(b.currentPassword || ''), u.salt, u.hash);
    if (!ok) throw new HttpError(400, 'Nuvarande lösenord stämmer inte.');
    const pw = String(b.newPassword);
    if (pw.length < 8) throw new HttpError(400, 'Det nya lösenordet behöver minst 8 tecken.');
    if (pw.length > 200) throw new HttpError(400, 'Lösenordet är för långt.');
    const { salt, hash } = await hashPassword(pw);
    u.salt = salt;
    u.hash = hash;
  }

  await redis('HSET', 'users', s.user, JSON.stringify(u));
  send(res, 200, { ok: true, displayName: u.displayName || u.username });
});
