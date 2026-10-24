import { handle, send, getSession, dbReady, CATEGORIES } from './_lib.js';

export default handle(async (req, res) => {
  const s = await getSession(req);
  send(res, 200, {
    user: s ? { role: s.role, label: s.label } : null,
    dbReady: dbReady(),
    categories: CATEGORIES,
    // Felsökning: visar bara om inställningarna finns, aldrig deras värden.
    setup: {
      miljo: process.env.VERCEL_ENV || 'lokal',
      databasUrl: Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
      databasToken: Boolean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN),
      adminkod: Boolean(process.env.ADMIN_CODE),
    },
  });
});
