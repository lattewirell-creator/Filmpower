// Felsökning: provar alternativa adresser för källor som inte svarade.
const UA = 'Mozilla/5.0 (compatible; FilmPowerNewsBot/1.0; +https://filmpower.vercel.app)';
const urls = [
  'https://culturecrave.co/feed', 'https://www.culturecrave.co/feed/', 'https://culturecrave.co/rss', 'https://culturecrave.co/rss.xml', 'https://culturecrave.co/feed.xml', 'https://culturecrave.co/',
  'https://discussingfilm.net/feed/', 'https://discussingfilm.net/',
  'https://cineuropa.org/en/rss/',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    const t = await r.text();
    const dates = [...t.matchAll(/<(pubDate|published|updated)>([^<]+)</g)].slice(0, 3).map((m) => m[2]);
    const alt = [...t.matchAll(/<link[^>]+type="application\/(rss|atom)\+xml"[^>]*>/g)].map((m) => m[0]).slice(0, 3);
    console.log(`\n${u} -> ${r.status} ${r.url} ${r.headers.get('content-type')} items:${(t.match(/<item[\s>]/g) || []).length} entries:${(t.match(/<entry[\s>]/g) || []).length}`);
    if (dates.length) console.log('  dates:', dates.join(' | '));
    if (alt.length) console.log('  feeds:', alt.join('\n         '));
    if (!dates.length && !alt.length) console.log('  start:', t.slice(0, 200).replace(/\s+/g, ' '));
  } catch (e) { console.log(`\n${u} -> FEL ${e.message}`); }
}
