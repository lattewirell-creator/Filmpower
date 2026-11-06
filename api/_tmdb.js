// Filmdata från TMDB (The Movie Database) till Film Powers konto: nytt på bio i Sverige,
// kommande premiärer och det som trendar, med bild, handling, regi, skådespelare och betyg.
// Kräver TMDB_API_KEY i Vercel: antingen API-nyckeln (v3) eller läs-token (v4, börjar med eyJ).
//
// Den här sajten använder TMDB:s API men är inte godkänd eller certifierad av TMDB.
import { redis, pipeline } from './_lib.js';

const BASE = () => (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/$/, '');
const IMG = () => (process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').replace(/\/$/, '');

export function tmdbKey() {
  return String(process.env.TMDB_API_KEY || process.env.TMDB_TOKEN || process.env.TMDB_READ_TOKEN || '').trim();
}

async function tmdb(path, params = {}) {
  const key = tmdbKey();
  const u = new URL(BASE() + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = 'Bearer ' + key;
  else u.searchParams.set('api_key', key);
  const r = await fetch(u, { headers, signal: AbortSignal.timeout(10000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('TMDB ' + r.status + (data.status_message ? ': ' + data.status_message : ''));
  return data;
}

// Testar nyckeln, för statusrutan i admin.
export async function tmdbCheck() {
  if (!tmdbKey()) return { ok: false, error: 'TMDB_API_KEY saknas' };
  try { await tmdb('/configuration'); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
}

const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
function runtime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} tim${m ? ' ' + m + ' min' : ''}` : `${m} min`;
}
const year = (d) => (d ? ' (' + d.slice(0, 4) + ')' : '');

// Skriver ett inlägg om en film. Saknas en svensk beskrivning hos TMDB hoppas filmen över,
// så att inget publiceras på engelska.
async function postFor(movie, kind) {
  const d = await tmdb('/movie/' + movie.id, { language: 'sv-SE', append_to_response: 'credits,release_dates' });
  const overview = String(d.overview || '').trim();
  if (overview.length < 40) return null;
  const title = d.title || movie.title;
  // Svenskt premiärdatum på bio om det finns, annars TMDB:s allmänna.
  const se = ((d.release_dates && d.release_dates.results) || []).find((r) => r.iso_3166_1 === 'SE');
  const seDate = se && (se.release_dates.find((x) => x.type === 3) || se.release_dates[0]);
  const release = (seDate && seDate.release_date ? seDate.release_date.slice(0, 10) : '') || d.release_date || '';
  const crew = (d.credits && d.credits.crew) || [], cast = (d.credits && d.credits.cast) || [];
  const directors = crew.filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 2);
  const actors = cast.slice(0, 3).map((c) => c.name);
  const genres = (d.genres || []).map((g) => g.name.charAt(0).toUpperCase() + g.name.slice(1)).slice(0, 3);

  const head = kind === 'now' ? `Ny på bio: ${title}${year(release)}`
    : kind === 'upcoming' ? `Snart på bio: ${title}${release ? ', premiär ' + shortDate(release) : ''}`
    : `Trendar just nu: ${title}${year(release)}`;
  const facts = [
    directors.length ? 'Regi: ' + directors.join(' och ') : '',
    actors.length ? 'Med ' + actors.join(', ') : '',
  ].filter(Boolean).join(' · ');
  const meta = [
    release ? (kind === 'trending' ? 'Premiär ' : 'Premiär i Sverige ') + fmtDate(release) : '',
    genres.join(', '),
    runtime(d.runtime),
    d.vote_count >= 20 && d.vote_average ? 'Betyg ' + d.vote_average.toFixed(1).replace('.', ',') + '/10 på TMDB' : '',
  ].filter(Boolean).join(' · ');
  const body = [overview, facts, meta].filter(Boolean).join('\n\n').slice(0, 5000);
  const img = d.backdrop_path ? IMG() + '/w780' + d.backdrop_path : d.poster_path ? IMG() + '/w500' + d.poster_path : '';
  return {
    tmdbId: d.id,
    title: head.slice(0, 140),
    body,
    source: 'TMDB',
    category: 'Bio & premiärer',
    link: 'https://www.themoviedb.org/movie/' + d.id,
    image: img,
  };
}

// Väljer dagens filmer: blandar nytt på bio, kommande premiärer och trender, och tar aldrig
// samma film två gånger.
export async function tmdbPicks(count) {
  const [now, upcoming, trending] = await Promise.allSettled([
    tmdb('/movie/now_playing', { language: 'sv-SE', region: 'SE' }),
    tmdb('/movie/upcoming', { language: 'sv-SE', region: 'SE' }),
    tmdb('/trending/movie/week', { language: 'sv-SE' }),
  ]);
  const lists = { now, upcoming, trending };
  const errors = Object.values(lists).filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (errors.length === 3) throw new Error(errors[0]);
  const today = new Date().toISOString().slice(0, 10);
  const pool = {};
  for (const [kind, r] of Object.entries(lists)) {
    const results = r.status === 'fulfilled' ? r.value.results || [] : [];
    pool[kind] = results
      .filter((m) => !m.adult && (m.backdrop_path || m.poster_path))
      .filter((m) => kind !== 'upcoming' || !m.release_date || m.release_date >= today)
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }
  const ids = [...new Set(Object.values(pool).flat().map((m) => String(m.id)))];
  const seen = ids.length ? await pipeline(ids.map((id) => ['SISMEMBER', 'bot:tmdb', id])) : [];
  const done = new Set(ids.filter((_, i) => seen[i]));
  const picked = [], used = new Set();
  const order = ['now', 'upcoming', 'trending'];
  // Sätter ihop dagens lista i tur och ordning, och hoppar över filmer utan svensk text.
  for (let round = 0; picked.length < count && round < 8; round++) {
    let progressed = false;
    for (const kind of order) {
      if (picked.length >= count) break;
      const m = pool[kind].find((x) => !done.has(String(x.id)) && !used.has(String(x.id)));
      if (!m) continue;
      used.add(String(m.id)); progressed = true;
      try { const p = await postFor(m, kind); if (p) picked.push(p); } catch (err) { errors.push(err.message); }
    }
    if (!progressed) break;
  }
  return { picked, errors };
}

export async function markTmdb(ids) {
  if (ids.length) await pipeline(ids.map((id) => ['SADD', 'bot:tmdb', String(id)]));
}
