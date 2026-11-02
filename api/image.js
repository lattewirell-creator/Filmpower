import { handleUpload } from '@vercel/blob/client';
import { handle, send, readBody, queryParam, getSession, HttpError, redis, blobToken } from './_lib.js';

// Videor laddas upp direkt från webbläsaren till Vercel Blob. Den här funktionen ger bara tillstånd.
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

async function videoToken(req, res) {
  const token = blobToken();
  if (!token) throw new HttpError(503, 'Videolagringen är inte kopplad. Koppla Blob-lagringen till projektet i Vercel och gör en redeploy.');
  const body = await readBody(req, 20_000);
  const result = await handleUpload({
    token,
    body,
    request: req,
    onBeforeGenerateToken: async () => {
      const s = await getSession(req);
      // Alla med eget konto kan lägga upp video i bloggen. Nyheter med video kräver fortfarande verifiering (se news.js).
      if (!s || !(s.role === 'admin' || s.verified || s.user)) throw new Error('Skapa ett eget konto för att ladda upp video.');
      return { allowedContentTypes: VIDEO_TYPES, maximumSizeInBytes: MAX_VIDEO_BYTES, addRandomSuffix: true };
    },
  });
  return send(res, 200, result);
}

// Visar en bild som hör till en nyhet, en profilbild eller en banner. Nyheterna är öppna, så bilderna är det också.
export default handle(async (req, res) => {
  // Felsökning för videouppladdning: är lagringen kopplad och får den inloggade ladda upp? Visar aldrig nyckeln.
  if (req.method === 'GET' && queryParam(req, 'video') === 'check') {
    const s = await getSession(req);
    const t = blobToken();
    return send(res, 200, {
      configured: Boolean(t),
      tokenLooksRight: /^vercel_blob_rw_/.test(t),
      signedIn: Boolean(s),
      allowed: Boolean(s && (s.role === 'admin' || s.verified || s.user)),
    });
  }
  if (req.method === 'POST' && queryParam(req, 'video')) {
    try { return await videoToken(req, res); } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message || 'Videon gick inte att ladda upp.');
    }
  }
  if (req.method !== 'GET') throw new HttpError(405, 'Använd GET.');

  const id = queryParam(req, 'id') || '';
  if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(400, 'Ogiltigt bild-id.');

  const data = await redis('GET', 'img:' + id);
  if (!data) throw new HttpError(404, 'Bilden finns inte.');

  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
  if (!m) throw new HttpError(500, 'Bilden är skadad.');

  const buf = Buffer.from(m[2], 'base64');
  res.statusCode = 200;
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Content-Length', buf.length);
  // Bilder ändras aldrig efter uppladdning, så webbläsaren får spara dem länge.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buf);
});
