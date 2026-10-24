// Testar nyhetsbotens källor: hämtar varje RSS-flöde med botens egen kod och visar vad den hittar.
import { parseFeed, FEEDS, articleImage } from '../api/bot.js';

const now = Date.now();
let total = 0;
for (const f of FEEDS) {
  try {
    const r = await fetch(f.url, { headers: { 'user-agent': 'FilmPowerNewsBot/1.0 (+https://filmpower.vercel.app)' }, signal: AbortSignal.timeout(10000) });
    const xml = await r.text();
    const items = parseFeed(xml, f.name);
    const fresh = items.filter((i) => !i.publishedAt || now - i.publishedAt < 48 * 3600 * 1000);
    total += fresh.length;
    console.log(`\n${f.name}: HTTP ${r.status}, ${items.length} nyheter, ${fresh.length} färska`);
    for (const i of fresh.slice(0, 3)) {
      const img = await articleImage(i);
      console.log(`  - ${i.title}\n    ${i.link}\n    ${i.summary.slice(0, 140)}\n    bild: ${i.image || 'ingen'} -> ${img ? Math.round(img.length * 0.75 / 1024) + ' kB sparad' : 'kunde inte sparas'}`);
    }
  } catch (err) {
    console.log(`\n${f.name}: FEL ${err.message}`);
  }
}
console.log(`\nTotalt ${total} färska nyheter att välja bland.`);
