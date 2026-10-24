import { handle, send, getSession, dbReady, CATEGORIES } from './_lib.js';

export default handle(async (req, res) => {
  const s = await getSession(req);
  send(res, 200, {
    user: s ? { role: s.role, label: s.label } : null,
    dbReady: dbReady(),
    categories: CATEGORIES,
  });
});
