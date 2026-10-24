import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession, HttpError, redis,
} from './_lib.js';

const ORDER = { pending: 0, active: 1, blocked: 2 };

export default handle(async (req, res) => {
  await requireSession(req, 'admin');

  if (req.method === 'GET') {
    const flat = await redis('HGETALL', 'users');
    const users = [];
    for (let i = 0; i < flat.length; i += 2) {
      const u = JSON.parse(flat[i + 1]);
      users.push({ id: flat[i], username: u.username, status: u.status, createdAt: u.createdAt });
    }
    users.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt - a.createdAt);
    return send(res, 200, { users });
  }

  requireAppHeader(req);
  const id = queryParam(req, 'id');
  if (!id) throw new HttpError(400, 'Id saknas.');
  const raw = await redis('HGET', 'users', id);
  if (!raw) throw new HttpError(404, 'Kontot finns inte.');

  if (req.method === 'PATCH') {
    const { status } = await readBody(req);
    if (!['active', 'blocked'].includes(status)) throw new HttpError(400, 'Ogiltig status.');
    const user = { ...JSON.parse(raw), status };
    await redis('HSET', 'users', id, JSON.stringify(user));
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    await redis('HDEL', 'users', id);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
