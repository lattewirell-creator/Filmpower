// Admin-AI-panelen. Laddas på hemsidan och bloggen men visas bara för inloggade admin.
// Admin skriver vad som ska ändras, AI:n gör ändringarna (förhandsvisning), admin publicerar eller slänger.
// Ligger i vendor/, som AI:n inte får ändra, så att panelen alltid fungerar och Ångra alltid finns.
(function () {
  if (window.__fpAdminAI) return;
  window.__fpAdminAI = true;

  var API = '/api/users?agent=';
  // Koden som krävs för AI:n. Sparas bara i fliken, så den behöver skrivas igen i en ny flik.
  var code = '';
  try { code = sessionStorage.getItem('fp_ai_code') || ''; } catch (e) {}
  function call(action, body) {
    var headers = { 'x-ai-code': code };
    if (body) { headers['content-type'] = 'application/json'; headers['x-fp'] = '1'; }
    return fetch(API + action, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var err = new Error(d.error || 'Något gick fel. Försök igen.');
          err.needCode = r.status === 403 && /kod/i.test(d.error || '');
          throw err;
        }
        return d;
      });
    });
  }

  // Kollar om den inloggade är admin. Anropas vid sidladdning och av bloggen vid in- och utloggning.
  var built = null;
  function check() {
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      var admin = Boolean(d && d.user && d.user.role === 'admin');
      if (admin && !built) built = build();
      else if (!admin && built) { built.remove(); built = null; }
    }).catch(function () {});
  }
  window.fpAdminAICheck = check;
  check();

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function build() {
    var made = [];
    var css = el('style');
    css.textContent = [
      '.aai-fab{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border:1px solid var(--line,#e4e6e1);border-radius:999px;background:transparent;color:var(--ink,#141614);font:500 .92rem/1 var(--body,system-ui,sans-serif);cursor:pointer}',
      '.aai-fab:hover{border-color:var(--brand,#3d7a2c);color:var(--brand,#3d7a2c)}',
      '.aai-fab.aai-wide{width:100%;height:2.9rem}',
      '.aai-fab.aai-icon{width:2.75rem;height:2.75rem;padding:0;flex:none}.aai-fab.aai-icon span{display:none}',
      '.aai-fab.aai-small{width:2.3rem;height:2.3rem}',
      '.content > .topbar > .aai-fab{margin-left:auto}',
      '.aai-fab.aai-float{position:fixed;left:max(20px,env(safe-area-inset-left,0px));bottom:max(20px,env(safe-area-inset-bottom,0px));z-index:80;height:3rem;padding:0 1.1rem;background:#141614;color:#f4f1e8;border:0}',
      '.aai-fab svg,.aai-head svg{width:1.2rem;height:1.2rem}',
      '.aai{position:fixed;left:max(20px,env(safe-area-inset-left,0px));bottom:max(20px,env(safe-area-inset-bottom,0px));z-index:81;width:min(27rem,calc(100vw - 32px));height:min(40rem,calc(100dvh - 40px));display:flex;flex-direction:column;background:var(--bg,#fafaf8);color:var(--ink,#141614);border:1px solid var(--line,#e4e6e1);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.32);overflow:hidden;font:400 .95rem/1.5 var(--body,system-ui,sans-serif)}',
      '.aai[hidden],.aai-fab[hidden],.aai-form[hidden]{display:none}',
      '.aai-head{display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;border-bottom:1px solid var(--line,#e4e6e1)}',
      '.aai-head .mk{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:50%;background:#141614;color:#f4f1e8;flex:none}',
      '.aai-head div{flex:1;display:grid;line-height:1.25}.aai-head b{font-weight:600}.aai-head small{color:var(--muted,#5d625b);font-size:.8rem}',
      '.aai-x{width:2.1rem;height:2.1rem;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer;font-size:1.3rem;line-height:1}',
      '.aai-log{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.55rem;overscroll-behavior:contain}',
      '.aai-me{align-self:flex-end;max-width:88%;background:var(--brand,#3d7a2c);color:var(--on-brand,#fff);padding:.6rem .85rem;border-radius:16px 16px 5px 16px;white-space:pre-wrap}',
      '.aai-bot{align-self:flex-start;max-width:92%;background:var(--soft,#eef1ea);padding:.65rem .9rem;border-radius:16px 16px 16px 5px;white-space:pre-wrap}',
      '.aai-step{align-self:flex-start;font-size:.82rem;color:var(--muted,#5d625b);padding-left:.2rem}',
      '.aai-step:before{content:"";display:inline-block;width:.45rem;height:.45rem;border-radius:50%;background:var(--brand,#3d7a2c);margin-right:.5rem;vertical-align:.08rem}',
      '.aai-err{align-self:stretch;border:1px solid #c0392b55;color:#c0392b;background:#c0392b10;padding:.6rem .85rem;border-radius:12px}',
      '.aai-card{align-self:stretch;border:1px solid var(--line,#e4e6e1);border-radius:14px;padding:.8rem .9rem;display:grid;gap:.5rem}',
      '.aai-card ul{margin:0;padding-left:1.1rem;font-size:.88rem}.aai-card .aai-row{display:flex;gap:.5rem;flex-wrap:wrap}',
      '.aai-btn{border:1px solid var(--line,#e4e6e1);background:var(--bg,#fff);color:inherit;border-radius:999px;padding:.5rem 1rem;font:500 .9rem var(--body,system-ui,sans-serif);cursor:pointer}',
      '.aai-btn.pri{background:var(--brand,#3d7a2c);border-color:transparent;color:var(--on-brand,#fff)}.aai-btn:disabled{opacity:.5;cursor:default}',
      '.aai-form{display:flex;align-items:flex-end;gap:.5rem;padding:.7rem;border-top:1px solid var(--line,#e4e6e1)}',
      '.aai-form textarea{flex:1;resize:none;max-height:8rem;border:1px solid var(--line,#e4e6e1);border-radius:14px;padding:.6rem .8rem;background:var(--bg,#fff);color:inherit;font:400 .95rem/1.4 var(--body,system-ui,sans-serif)}',
      '.aai-form button{width:2.6rem;height:2.6rem;flex:none;border:0;border-radius:50%;background:var(--brand,#3d7a2c);color:var(--on-brand,#fff);cursor:pointer;font-size:1.1rem}',
      '.aai-form .aai-att{background:none;color:var(--muted,#5d625b);border:1px solid var(--line,#e4e6e1)}.aai-form .aai-att svg{width:1.15rem;height:1.15rem;vertical-align:middle}',
      '.aai-thumb{align-self:flex-end;max-width:60%;max-height:9rem;border-radius:12px;object-fit:cover}',
      '.aai-form button:disabled{opacity:.45;cursor:default}',
      '.aai-dots{display:inline-flex;gap:.25rem}.aai-dots i{width:.4rem;height:.4rem;border-radius:50%;background:var(--muted,#5d625b);animation:aaib 1.2s infinite}',
      '.aai-dots i:nth-child(2){animation-delay:.15s}.aai-dots i:nth-child(3){animation-delay:.3s}@keyframes aaib{0%,80%,100%{opacity:.25}40%{opacity:1}}',
      '.aai-hb{width:2.1rem;height:2.1rem;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer;display:grid;place-items:center}.aai-hb:hover,.aai-x:hover{background:var(--soft,#eef1ea)}.aai-hb svg{width:1.1rem;height:1.1rem}',
      '.aai.aai-big{width:min(60rem,calc(100vw - 40px));height:calc(100dvh - 40px)}',
      '.aai-diff{display:grid;gap:.3rem;font-size:.84rem;margin:0}.aai-diff div{display:grid;gap:.1rem;padding:.35rem .5rem;border-radius:8px;background:var(--soft,#eef1ea)}',
      '.aai-diff del{color:#b03a2e;text-decoration:line-through;text-decoration-color:#b03a2e88}.aai-diff ins{color:var(--brand,#3d7a2c);text-decoration:none;font-weight:600}.aai-diff small{color:var(--muted,#5d625b)}',
      '.aai-ver{display:flex;align-items:center;gap:.5rem;justify-content:space-between;font-size:.86rem;padding:.35rem 0;border-top:1px solid var(--line,#e4e6e1)}.aai-ver:first-of-type{border-top:0}.aai-ver span{flex:1;min-width:0}.aai-ver small{display:block;color:var(--muted,#5d625b)}',
      '.aai-stop{align-self:flex-start}',
      '.aai-tips{display:flex;flex-wrap:wrap;gap:.4rem}.aai-tip{font-size:.82rem;padding:.4rem .75rem}',
      '.aai-lock{margin:auto;display:grid;gap:.7rem;justify-items:center;text-align:center;max-width:16rem}',
      '.aai-lock input{width:9rem;text-align:center;letter-spacing:.5em;font:600 1.4rem/1 var(--body,system-ui,sans-serif);padding:.6rem .4rem .6rem .9rem;border:1px solid var(--line,#e4e6e1);border-radius:12px;background:var(--bg,#fff);color:inherit}',
      '.aai-lock p{margin:0;color:var(--muted,#5d625b);font-size:.88rem}.aai-lock .bad{color:#c0392b}',
      '@media (max-width:560px){.aai{left:0;bottom:0;width:100vw;height:100dvh;border-radius:0;border:0}}',
    ].join('\n');
    document.head.appendChild(css);
    made.push(css);

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
    // Knappen läggs i sidornas egna menyer så att den aldrig ligger framför innehållet:
    // hemsidans sidomeny (dator) och toppfält (mobil), och bloggens sidhuvud.
    function makeBtn(cls) {
      var b = el('button', 'aai-fab ' + cls);
      b.type = 'button';
      b.innerHTML = ICON + '<span>Bygg med AI</span>';
      b.setAttribute('aria-label', 'Bygg med AI');
      b.title = 'Bygg med AI';
      return b;
    }
    var buttons = [];
    var sideFoot = document.querySelector('.side-foot'), homeTop = document.querySelector('body > .content > .topbar .menu-btn, .topbar .menu-btn');
    var who = document.getElementById('who'), logout = document.getElementById('logout-btn');
    if (sideFoot) { var b1 = makeBtn('aai-wide'); sideFoot.insertBefore(b1, sideFoot.firstChild); buttons.push(b1); }
    if (homeTop) { var b2 = makeBtn('aai-icon'); homeTop.parentNode.insertBefore(b2, homeTop); buttons.push(b2); homeTop.parentNode.style.gap = '.5rem'; }
    if (who && logout) { var b3 = makeBtn('aai-icon aai-small'); who.insertBefore(b3, logout); buttons.push(b3); }
    if (!buttons.length) { var b4 = makeBtn('aai-float'); document.body.appendChild(b4); buttons.push(b4); }
    made = made.concat(buttons);
    var box = el('section', 'aai');
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Bygg med AI');
    box.innerHTML = '<div class="aai-head"><span class="mk">' + ICON + '</span><div><b>Bygg med AI</b><small>Ändra hemsidan och bloggen. Inget går ut förrän du publicerar.</small></div><button class="aai-hb aai-hist" type="button" aria-label="Tidigare versioner" title="Tidigare versioner"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg></button><button class="aai-hb aai-grow" type="button" aria-label="Större fönster" title="Större fönster"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button><button class="aai-x" type="button" aria-label="Stäng">×</button></div>' +
      '<div class="aai-log" aria-live="polite"></div>' +
      '<form class="aai-form"><button type="button" class="aai-att" aria-label="Ladda upp en bild" title="Ladda upp en bild"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button><input type="file" accept="image/*" hidden><textarea rows="2" maxlength="2000" placeholder="T.ex. Gör en ny sida om oss med bilder"></textarea><button type="submit" aria-label="Skicka">↑</button></form>';
    document.body.appendChild(box);
    made.push(box);

    var log = box.querySelector('.aai-log'), form = box.querySelector('form'), ta = form.querySelector('textarea'), sendBtn = form.querySelector('button[type=submit]');
    var attBtn = form.querySelector('.aai-att'), fileIn = form.querySelector('input[type=file]');
    var sessionId = '', busy = false, from = 0, statusLoaded = false;
    try { sessionId = sessionStorage.getItem('fp_ai_session') || ''; } catch (e) {}

    // Chatten sparas i fliken, så att den finns kvar när sidan laddas om (t.ex. efter Publicera).
    var history = [];
    try { history = JSON.parse(sessionStorage.getItem('fp_ai_log') || '[]'); } catch (e) {}
    function remember(cls, text) {
      if (!text || !/^aai-(me|bot|err)$/.test(cls)) return;
      history.push([cls, text]); history = history.slice(-40);
      try { sessionStorage.setItem('fp_ai_log', JSON.stringify(history)); } catch (e) {}
    }
    var stopEl = null;
    function add(cls, text) { var d = el('div', cls, text); log.appendChild(d); if (stopEl && stopEl.parentNode) log.appendChild(stopEl); log.scrollTop = log.scrollHeight; remember(cls, text); return d; }
    function setBusy(b) { busy = b; sendBtn.disabled = b; ta.disabled = b; attBtn.disabled = b; }

    // Egen bild: förminskas i webbläsaren, sparas hos sajten och adressen läggs i meddelandet till AI:n.
    function shrink(file) {
      return new Promise(function (ok, fail) {
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () {
          var k = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          ok(file.type === 'image/png' && file.size < 1500000 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86));
        };
        img.onerror = function () { fail(new Error('Bilden gick inte att läsa.')); };
        img.src = url;
      });
    }
    attBtn.addEventListener('click', function () { if (!busy) fileIn.click(); });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      setBusy(true);
      var wait = add('aai-step', 'Laddar upp bilden…');
      shrink(f).then(function (data) { return call('upload', { data: data }); }).then(function (r) {
        var t = el('img', 'aai-thumb'); t.src = r.url; t.alt = ''; log.appendChild(t);
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : 'Använd den här bilden: ') + '[bild: ' + r.url + ']';
        wait.textContent = 'Bilden är uppladdad. Skriv var den ska in och skicka.';
      }).catch(function (err) { wait.remove(); fail(err); })
        .then(function () { setBusy(false); ta.focus(); });
    });

    // Kodlåset: visas tills rätt kod är skriven. Servern kollar koden vid varje anrop.
    function lock(msg) {
      code = ''; try { sessionStorage.removeItem('fp_ai_code'); } catch (e) {}
      statusLoaded = false;
      log.innerHTML = ''; form.hidden = true;
      var f = el('form', 'aai-lock');
      f.innerHTML = '<b>Skriv koden för att använda AI:n</b><input type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="Kod"><button class="aai-btn pri" type="submit">Lås upp</button><p></p>';
      var inp = f.querySelector('input'), p = f.querySelector('p'), btn = f.querySelector('button');
      if (msg) { p.textContent = msg; p.className = 'bad'; }
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!inp.value.trim()) return inp.focus();
        code = inp.value.trim(); btn.disabled = true;
        call('status').then(function (s) {
          try { sessionStorage.setItem('fp_ai_code', code); } catch (e) {}
          f.remove(); form.hidden = false; statusLoaded = true; greet(s); ta.focus();
        }).catch(function (err) {
          if (!err.needCode) code = '';
          btn.disabled = false; inp.value = ''; inp.focus();
          p.textContent = err.message; p.className = 'bad';
        });
      });
      log.appendChild(f);
      setTimeout(function () { inp.focus(); }, 0);
    }
    function fail(err) { if (err.needCode) lock(err.message); else add('aai-err', err.message); }
    function greet(s) {
      if (history.length) {
        history.forEach(function (h) { log.appendChild(el('div', h[0], h[1])); });
        var clear = el('button', 'aai-btn aai-tip', 'Börja om med en tom chatt'); clear.type = 'button';
        clear.addEventListener('click', function () {
          history = []; try { sessionStorage.removeItem('fp_ai_log'); sessionStorage.removeItem('fp_ai_session'); } catch (e) {}
          sessionId = ''; log.innerHTML = ''; greet(s);
        });
        log.appendChild(clear);
        if (s.last) undoCard(s.last);
        log.scrollTop = log.scrollHeight;
        return;
      }
      add('aai-bot', 'Hej! Beskriv vad du vill ändra eller bygga på hemsidan eller bloggen, eller fråga mig vad som helst. Jag gör ändringarna och visar dem för dig. Inget syns för besökarna förrän du trycker Publicera.');
      var tips = el('div', 'aai-tips');
      ['Gör en ny sida om oss med bilder', 'Lägg till kundomdömen under priserna', 'Byt bilden högst upp mot en filmkamera', 'Skriv ett blogginlägg om ljussättning', 'Vilka konton väntar på godkännande?', 'Vad kan jag förbättra på hemsidan?'].forEach(function (t) {
        var c = el('button', 'aai-btn aai-tip', t); c.type = 'button';
        c.addEventListener('click', function () { if (busy) return; tips.remove(); ta.value = t; form.requestSubmit(); });
        tips.appendChild(c);
      });
      if (!s.ready) add('aai-err', 'GROQ_API_KEY saknas på Vercel, så jag kan inte arbeta än.');
      else add('aai-step', 'Jag kan ändra allt på hemsidan och bloggen, bygga nya sidor, hitta och lägga in bilder (eller använda dina, tryck på bildknappen), läsa andra webbsidor, skriva blogginlägg och sköta konton. Ändringar syns direkt efter Publicera.');
      if (s.ready) log.appendChild(tips);
      if (s.last) undoCard(s.last);
    }
    function open() {
      box.hidden = false;
      if (statusLoaded) return ta.focus();
      if (!code) return lock();
      statusLoaded = true; ta.focus();
      call('status').then(function (s) {
        greet(s);
      }).catch(function (err) { statusLoaded = false; fail(err); });
    }
    function close() { box.hidden = true; }
    buttons.forEach(function (b) { b.addEventListener('click', function () { if (box.hidden) open(); else close(); }); });
    box.querySelector('.aai-x').addEventListener('click', close);
    box.querySelector('.aai-grow').addEventListener('click', function () { box.classList.toggle('aai-big'); log.scrollTop = log.scrollHeight; });
    box.querySelector('.aai-hist').addEventListener('click', function () { if (statusLoaded) versionsCard(); });
    // Öppnas igen av sig själv efter omladdningen som följer på Publicera.
    try { if (sessionStorage.getItem('fp_ai_reopen')) { sessionStorage.removeItem('fp_ai_reopen'); setTimeout(open, 300); } } catch (e) {}

    var DAY = function (t) { var d = new Date(t); return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }); };
    function versionsCard() {
      var c = el('div', 'aai-card');
      c.appendChild(el('b', null, 'Tidigare versioner'));
      var list = el('div'); list.appendChild(el('small', null, 'Hämtar…')); c.appendChild(list);
      log.appendChild(c); log.scrollTop = log.scrollHeight;
      call('versions', {}).then(function (r) {
        list.innerHTML = '';
        if (!r.versions.length) { list.appendChild(el('small', null, 'Inga sparade versioner än. De sparas när du publicerar.')); return; }
        r.versions.forEach(function (v) {
          var row = el('div', 'aai-ver'), t = el('span');
          t.appendChild(document.createTextNode((v.page === 'home' ? 'Hemsidan' : 'Bloggen') + ': ' + v.request.slice(0, 70)));
          t.appendChild(el('small', null, DAY(v.savedAt) + (v.current ? ' · visas nu' : !v.usable ? ' · gjord för en äldre sida' : '')));
          row.appendChild(t);
          if (!v.current && v.usable) {
            var btn = el('button', 'aai-btn', 'Återställ'); btn.type = 'button';
            btn.addEventListener('click', function () {
              if (!window.confirm('Återställa ' + (v.page === 'home' ? 'hemsidan' : 'bloggen') + ' till den här versionen?')) return;
              btn.disabled = true;
              call('restore', { page: v.page, savedAt: v.savedAt }).then(function () {
                add('aai-bot', 'Återställt. Sidan laddas om strax.');
                try { sessionStorage.setItem('fp_ai_reopen', '1'); } catch (e) {}
                setTimeout(function () { location.reload(); }, 11000);
              }).catch(function (err) { btn.disabled = false; fail(err); });
            });
            row.appendChild(btn);
          }
          list.appendChild(row);
        });
      }).catch(function (err) { c.remove(); fail(err); });
    }

    function undoCard(last) {
      var c = el('div', 'aai-card');
      c.appendChild(el('div', null, 'Senaste AI-ändringen: "' + last.request + '"'));
      var row = el('div', 'aai-row'), b = el('button', 'aai-btn', 'Ångra den');
      b.type = 'button';
      b.addEventListener('click', function () {
        if (!window.confirm('Ångra den senaste AI-ändringen? Sajten går tillbaka till hur den var innan.')) return;
        b.disabled = true;
        call('undo', {}).then(function (r) { c.remove(); add('aai-bot', 'Ändringen är ångrad. ' + (r.instant ? 'Ladda om sidan om några sekunder.' : 'Sajten uppdateras om ungefär en minut.')); })
          .catch(function (err) { b.disabled = false; fail(err); });
      });
      row.appendChild(b); c.appendChild(row); log.appendChild(c);
    }

    function show(d) {
      (d.events || []).forEach(function (e) { add('aai-step', e.text); });
      from = d.eventCount || from;
      if (!d.done) return;
      add('aai-bot', d.summary || 'Klart.');
      if (!(d.changes || []).length && !(d.actions || []).length) return;
      var c = el('div', 'aai-card');
      c.appendChild(el('b', null, 'Förhandsvisning av ändringen'));
      var ul = el('ul');
      var NAMES = { 'index.html': 'Hemsidan', 'nyheter/index.html': 'Bloggen' };
      d.changes.forEach(function (x) { ul.appendChild(el('li', null, (NAMES[x.path] || x.path.replace(/^sidor\/(.*)\.html$/, 'Ny sida /sida/$1')) + (x.created ? ' (ny)' : ''))); });
      d.actions.forEach(function (a) { ul.appendChild(el('li', null, a)); });
      c.appendChild(ul);
      // Före och efter för texten, så att man ser exakt vad som ändras innan man publicerar.
      d.changes.forEach(function (x) {
        if (!(x.diff || []).length) return;
        var box2 = el('div', 'aai-diff');
        x.diff.forEach(function (r) {
          var row = el('div');
          if (r.code) { row.appendChild(el('small', null, r.code + ' rader kod eller design ändrade')); box2.appendChild(row); return; }
          if (r.before) row.appendChild(el('del', null, r.before));
          if (r.after) row.appendChild(el('ins', null, r.after));
          box2.appendChild(row);
        });
        c.appendChild(box2);
      });
      c.appendChild(el('small', null, 'Vill du justera något, skriv det nedan innan du publicerar.'));
      var row = el('div', 'aai-row'), pub = el('button', 'aai-btn pri', 'Publicera'), drop = el('button', 'aai-btn', 'Släng');
      // Förhandsgranska: öppnar den ändrade sidan i en ny flik (sidor som ändrats, t.ex. index.html).
      d.changes.filter(function (x) { return /\.html$/i.test(x.path); }).forEach(function (x) {
        var pv = el('button', 'aai-btn', 'Förhandsgranska ' + (x.path === 'index.html' ? 'hemsidan' : x.path === 'nyheter/index.html' ? 'bloggen' : x.path));
        pv.type = 'button';
        pv.addEventListener('click', function () {
          var w = window.open('', '_blank');
          call('preview', { sessionId: sessionId, path: x.path }).then(function (r) {
            if (!w) { add('aai-err', 'Webbläsaren stoppade fliken. Tillåt popup-fönster för sajten.'); return; }
            var base = '/' + x.path.replace(/[^/]*$/, '');
            var html = r.html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '"><script>window.__fpPreview=1;window.__fpPage=1;</' + 'script>');
            html = html.replace(/<body([^>]*)>/i, '<body$1><div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#141614;color:#f4f1e8;font:500 13px system-ui;padding:6px 12px;text-align:center">Förhandsvisning, inte publicerad än</div>');
            w.document.open(); w.document.write(html); w.document.close();
          }).catch(function (err) { if (w) w.close(); add('aai-err', err.message); });
        });
        row.appendChild(pv);
      });
      pub.type = drop.type = 'button';
      pub.addEventListener('click', function () {
        pub.disabled = drop.disabled = true; pub.textContent = 'Publicerar…';
        call('publish', { sessionId: sessionId }).then(function (r) {
          c.remove();
          add('aai-bot', ['Publicerat!', !r.files ? 'Klart.' : r.instant ? '' : 'Sajten uppdateras om ungefär en minut, ladda sedan om sidan.', r.files ? 'Ångrar du dig kan du ångra ändringen här, eller gå tillbaka flera steg med klockknappen högst upp.' : ''].filter(Boolean).join(' '));
          (r.pages || []).forEach(function (u) { var a = el('a', 'aai-btn', 'Öppna ' + u); a.href = u; a.target = '_blank'; a.rel = 'noopener'; log.appendChild(a); });
          if (r.files) undoCard({ request: lastRequest });
          // Sidan laddas om av sig själv när ändringen hunnit ut (servern mellanlagrar i 10 sekunder).
          if (r.files > (r.pages || []).length && r.instant) {
            var left = 12, note = add('aai-step', '');
            var tick = setInterval(function () {
              note.textContent = 'Laddar om sidan om ' + left + ' sekunder så att du ser ändringen…';
              if (left-- <= 0) { clearInterval(tick); try { sessionStorage.setItem('fp_ai_reopen', '1'); } catch (e) {} location.reload(); }
            }, 1000);
          }
          sessionId = ''; try { sessionStorage.removeItem('fp_ai_session'); } catch (e) {}
        }).catch(function (err) { pub.disabled = drop.disabled = false; pub.textContent = 'Publicera'; add('aai-err', err.message); });
      });
      drop.addEventListener('click', function () {
        call('discard', { sessionId: sessionId }).catch(function () {});
        c.remove(); add('aai-bot', 'Ändringen är slängd. Inget har publicerats.');
        sessionId = ''; try { sessionStorage.removeItem('fp_ai_session'); } catch (e) {}
      });
      row.appendChild(pub); row.appendChild(drop); c.appendChild(row); log.appendChild(c);
      log.scrollTop = log.scrollHeight;
    }

    var lastRequest = '', stopped = false;
    function step(promise, wait) {
      return promise.then(function (d) {
        sessionId = d.sessionId;
        try { sessionStorage.setItem('fp_ai_session', sessionId); } catch (e) {}
        show(d);
        if (stopped && !d.done) { add('aai-bot', 'Stoppad. Inget har publicerats. Skriv vad du vill i stället, så fortsätter jag därifrån.'); return; }
        if (!d.done) return step(call('continue', { sessionId: sessionId, from: from }), wait);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text || busy) return;
      lastRequest = text;
      add('aai-me', text);
      ta.value = '';
      setBusy(true);
      var wait = add('aai-step', '');
      wait.innerHTML = '<span class="aai-dots"><i></i><i></i><i></i></span>';
      var stop = el('button', 'aai-btn aai-tip aai-stop', 'Stoppa'); stop.type = 'button';
      stop.addEventListener('click', function () { stopped = true; stop.disabled = true; stop.textContent = 'Stoppar efter det här steget…'; });
      log.appendChild(stop); stopEl = stop;
      from = 0; stopped = false;
      step(call('start', { message: text, sessionId: sessionId }))
        .catch(fail)
        .then(function () { wait.remove(); stop.remove(); setBusy(false); ta.focus(); });
    });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    return { remove: function () { made.forEach(function (n) { n.remove(); }); } };
  }
})();
