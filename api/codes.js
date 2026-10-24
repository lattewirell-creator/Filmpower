import {
  handle, send, readBody, queryParam, requireAppHeader, requireSession,
  HttpError, redis, generateCode, hashCode,
} from './_lib.js';

async function allCodes() {
  const flat = await redis('HGETALL', 'codes');
  const list = [];
  for (let i = 0; i < flat.length; i += 2) list.push({ hash: flat[i], ...JSON.parse(flat[i + 1]) });
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export default handle(async (req, res) => {
  await requireSession(req, 'admin');

  if (req.method === 'GET') {
    const codes = (await allCodes()).map(({ id, label, hint, createdAt }) => ({ id, label, hint, createdAt }));
    return send(res, 200, { codes });
  }

  requireAppHeader(req);

  if (req.method === 'POST') {
    const { label } = await readBody(req);
    const name = String(label || '').trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'Skriv vem koden är till.');
    const code = generateCode();
    const hash = hashCode(code);
    const info = { id: hash.slice(0, 12), label: name, hint: code.slice(-4), createdAt: Date.now() };
    await redis('HSET', 'codes', hash, JSON.stringify(info));
    return send(res, 201, { code, ...info });
  }

  if (req.method === 'DELETE') {
    const id = queryParam(req, 'id');
    const match = (await allCodes()).find((c) => c.id === id);
    if (!match) throw new HttpError(404, 'Koden finns inte.');
    await redis('HDEL', 'codes', match.hash);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(405, 'Metoden stöds inte.');
});
