import { handleUpload } from '@vercel/blob/client';
import { handle, send, readBody, queryParam, getSession, HttpError, redis } from './_lib.js';

// Videor laddas upp direkt från webbläsaren till Vercel Blob. Den här funktionen ger bara tillstånd.
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

async function videoToken(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, 'Videolagringen är inte kopplad. Koppla Blob-lagringen till projektet i Vercel och gör en redeploy.');
  const body = await readBody(req, 20_000);
  const result = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async () => {
      const s = await getSession(req);
      if (!s || !(s.role === 'admin' || s.verified)) throw new Error('Bara verifierade konton kan ladda upp video.');
      return { allowedContentTypes: VIDEO_TYPES, maximumSizeInBytes: MAX_VIDEO_BYTES, addRandomSuffix: true };
    },
  });
  return send(res, 200, result);
}

// Visar en bild som hör till en nyhet, en profilbild eller en banner. Nyheterna är öppna, så bilderna är det också.
export default handle(async (req, res) => {
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
