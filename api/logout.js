import { handle, send, HttpError, clearCookie } from './_lib.js';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Använd POST.');
  send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
});
