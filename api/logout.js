import { handle, send, HttpError, clearCookie, readBody, otherAccounts, stillValid, switchCookies, accountsCookie, sessionId } from './_lib.js';

// Loggar ut det aktiva kontot. Finns fler inloggade konton byter sajten till nästa, som på Twitter.
// { all: true } loggar ut alla konton.
export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Använd POST.');
  const b = await readBody(req).catch(() => ({}));
  if (!b.all) {
    for (const p of otherAccounts(req)) {
      if (!(await stillValid(p))) continue;
      const cookies = switchCookies(req, p);
      // Det utloggade kontot ska inte ligga kvar bland de andra.
      const rest = otherAccounts(req).filter((x) => sessionId(x) !== sessionId(p));
      return send(res, 200, { ok: true, switched: true }, { 'Set-Cookie': [cookies[0], accountsCookie(req, rest)] });
    }
  }
  send(res, 200, { ok: true }, { 'Set-Cookie': [clearCookie(req), accountsCookie(req, [])] });
});
