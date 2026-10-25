import { handle, send, getSession, dbReady, CATEGORIES, queryParam } from './_lib.js';
import { servePage } from './_pages.js';

export default handle(async (req, res) => {
  // AI-versionen av en sida (hemsidan eller bloggen), se _pages.js.
  if (queryParam(req, 'page')) return servePage(req, res, queryParam(req, 'page'));
  const s = await getSession(req);
  send(res, 200, {
    user: s ? { role: s.role, label: s.label, verified: Boolean(s.verified), avatar: s.avatar || '', anon: Boolean(s.anon) } : null,
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
