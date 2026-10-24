import { handle, queryParam, HttpError, redis } from './_lib.js';

// Visar en bild som hör till en nyhet, en profilbild eller en banner. Nyheterna är öppna, så bilderna är det också.
export default handle(async (req, res) => {
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
