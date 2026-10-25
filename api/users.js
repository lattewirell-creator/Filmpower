import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession, HttpError, redis, affKey, usernameKey,
} from './_lib.js';
import { agentHandler } from './_agent.js';

const ORDER = { pending: 0, active: 1, blocked: 2 };

export default handle(async (req, res) => {
  const s = await requireSession(req, 'admin');

  // Admin-AI:n som ändrar hemsidan och bloggen (se _agent.js).
  if (queryParam(req, 'agent')) return agentHandler(req, res, s);

  if (req.method === 'GET') {
    const flat = await redis('HGETALL', 'users');
    const users = [];
    for (let i = 0; i < flat.length; i += 2) {
      const u = JSON.parse(flat[i + 1]);
      users.push({ id: flat[i], username: u.username, displayName: u.displayName || '', status: u.status, role: u.role === 'admin' ? 'admin' : 'member', verified: Boolean(u.verified), affiliateOf: affKey(u), createdAt: u.createdAt });
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
    const { status, role, verified, affiliate, affiliateOf } = await readBody(req);
    const user = JSON.parse(raw);
    if (status !== undefined) {
      if (!['active', 'blocked'].includes(status)) throw new HttpError(400, 'Ogiltig status.');
      user.status = status;
    }
    if (role !== undefined) {
      if (!['admin', 'member'].includes(role)) throw new HttpError(400, 'Ogiltig roll.');
      if (role === 'admin' && user.status !== 'active') throw new HttpError(400, 'Godkänn kontot innan det blir admin.');
      user.role = role;
    }
    if (verified !== undefined) {
      if (verified && user.status !== 'active') throw new HttpError(400, 'Godkänn kontot innan det verifieras.');
      user.verified = Boolean(verified);
    }
    // Anslut till Film Power eller till ett annat aktivt konto. Tom sträng tar bort anslutningen.
    const target = affiliateOf !== undefined ? usernameKey(affiliateOf) : affiliate !== undefined ? (affiliate ? 'filmpower' : '') : undefined;
    if (target !== undefined) {
      if (target) {
        if (user.status !== 'active') throw new HttpError(400, 'Kontot måste vara aktivt för att anslutas.');
        if (target === id) throw new HttpError(400, 'Ett konto kan inte anslutas till sig självt.');
        if (target !== 'filmpower') {
          const org = await redis('HGET', 'users', target);
          if (!org || JSON.parse(org).status !== 'active') throw new HttpError(400, 'Kontot du vill ansluta till finns inte.');
        }
      }
      user.affiliateOf = target;
      delete user.affiliate;
    }
    await redis('HSET', 'users', id, JSON.stringify(user));
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    await redis('HDEL', 'users', id);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
