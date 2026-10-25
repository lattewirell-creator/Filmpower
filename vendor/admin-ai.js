// Admin-AI-panelen. Laddas på hemsidan och bloggen men visas bara för inloggade admin.
// Admin skriver vad som ska ändras, AI:n gör ändringarna (förhandsvisning), admin publicerar eller slänger.
// Ligger i vendor/, som AI:n inte får ändra, så att panelen alltid fungerar och Ångra alltid finns.
(function () {
  if (window.__fpAdminAI) return;
  window.__fpAdminAI = true;

  var API = '/api/users?agent=';
  function call(action, body) {
    return fetch(API + action, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json', 'x-fp': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Något gick fel. Försök igen.');
        return d;
      });
    });
  }

  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.user && d.user.role === 'admin') build();
  }).catch(function () {});

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function build() {
    var css = el('style');
    css.textContent = [
      '.aai-fab{position:fixed;left:max(20px,env(safe-area-inset-left,0px));bottom:max(20px,env(safe-area-inset-bottom,0px));z-index:80;display:inline-flex;align-items:center;gap:.5rem;height:3rem;padding:0 1.1rem 0 .95rem;border:0;border-radius:999px;background:#141614;color:#f4f1e8;font:500 .95rem/1 var(--body,system-ui,sans-serif);box-shadow:0 10px 26px rgba(0,0,0,.3);cursor:pointer}',
      '.aai-fab svg,.aai-head svg{width:1.2rem;height:1.2rem}',
      '.aai{position:fixed;left:max(20px,env(safe-area-inset-left,0px));bottom:max(20px,env(safe-area-inset-bottom,0px));z-index:81;width:min(27rem,calc(100vw - 32px));height:min(40rem,calc(100dvh - 40px));display:flex;flex-direction:column;background:var(--bg,#fafaf8);color:var(--ink,#141614);border:1px solid var(--line,#e4e6e1);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.32);overflow:hidden;font:400 .95rem/1.5 var(--body,system-ui,sans-serif)}',
      '.aai[hidden],.aai-fab[hidden]{display:none}',
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
      '.aai-card ul{margin:0;padding-left:1.1rem;font-size:.88rem}.aai-card .row{display:flex;gap:.5rem;flex-wrap:wrap}',
      '.aai-btn{border:1px solid var(--line,#e4e6e1);background:var(--bg,#fff);color:inherit;border-radius:999px;padding:.5rem 1rem;font:500 .9rem var(--body,system-ui,sans-serif);cursor:pointer}',
      '.aai-btn.pri{background:var(--brand,#3d7a2c);border-color:transparent;color:var(--on-brand,#fff)}.aai-btn:disabled{opacity:.5;cursor:default}',
      '.aai-form{display:flex;align-items:flex-end;gap:.5rem;padding:.7rem;border-top:1px solid var(--line,#e4e6e1)}',
      '.aai-form textarea{flex:1;resize:none;max-height:8rem;border:1px solid var(--line,#e4e6e1);border-radius:14px;padding:.6rem .8rem;background:var(--bg,#fff);color:inherit;font:400 .95rem/1.4 var(--body,system-ui,sans-serif)}',
      '.aai-form button{width:2.6rem;height:2.6rem;flex:none;border:0;border-radius:50%;background:var(--brand,#3d7a2c);color:var(--on-brand,#fff);cursor:pointer;font-size:1.1rem}',
      '.aai-form button:disabled{opacity:.45;cursor:default}',
      '.aai-dots{display:inline-flex;gap:.25rem}.aai-dots i{width:.4rem;height:.4rem;border-radius:50%;background:var(--muted,#5d625b);animation:aaib 1.2s infinite}',
      '.aai-dots i:nth-child(2){animation-delay:.15s}.aai-dots i:nth-child(3){animation-delay:.3s}@keyframes aaib{0%,80%,100%{opacity:.25}40%{opacity:1}}',
      '@media (max-width:560px){.aai{left:0;bottom:0;width:100vw;height:100dvh;border-radius:0;border:0}.aai-fab span{display:none}.aai-fab{width:3.2rem;padding:0;justify-content:center}}',
    ].join('\n');
    document.head.appendChild(css);

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
    var fab = el('button', 'aai-fab');
    fab.type = 'button';
    fab.innerHTML = ICON + '<span>Bygg med AI</span>';
    fab.setAttribute('aria-label', 'Bygg med AI');
    var box = el('section', 'aai');
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Bygg med AI');
    box.innerHTML = '<div class="aai-head"><span class="mk">' + ICON + '</span><div><b>Bygg med AI</b><small>Ändra hemsidan och bloggen. Inget går ut förrän du publicerar.</small></div><button class="aai-x" type="button" aria-label="Stäng">×</button></div>' +
      '<div class="aai-log" aria-live="polite"></div>' +
      '<form class="aai-form"><textarea rows="2" maxlength="2000" placeholder="T.ex. Lägg till en sektion med kundomdömen under priserna"></textarea><button type="submit" aria-label="Skicka">↑</button></form>';
    document.body.appendChild(fab);
    document.body.appendChild(box);

    var log = box.querySelector('.aai-log'), form = box.querySelector('form'), ta = form.querySelector('textarea'), sendBtn = form.querySelector('button');
    var sessionId = '', busy = false, from = 0, statusLoaded = false;
    try { sessionId = sessionStorage.getItem('fp_ai_session') || ''; } catch (e) {}

    function add(cls, text) { var d = el('div', cls, text); log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
    function setBusy(b) { busy = b; sendBtn.disabled = b; ta.disabled = b; }

    function open() {
      box.hidden = false; fab.hidden = true; ta.focus();
      if (statusLoaded) return;
      statusLoaded = true;
      call('status').then(function (s) {
        add('aai-bot', 'Hej! Beskriv vad du vill ändra eller bygga på hemsidan eller bloggen. Jag gör ändringarna och visar dem för dig. Inget syns för besökarna förrän du trycker Publicera.');
        if (!s.ready) add('aai-err', !s.github ? 'GITHUB_TOKEN saknas på Vercel, så jag kan inte ändra sajten än. Instruktionen finns i README under "Bygg med AI".' : 'GROQ_API_KEY saknas på Vercel.');
        if (s.last) undoCard(s.last);
      }).catch(function (err) { add('aai-err', err.message); });
    }
    function close() { box.hidden = true; fab.hidden = false; }
    fab.addEventListener('click', open);
    box.querySelector('.aai-x').addEventListener('click', close);

    function undoCard(last) {
      var c = el('div', 'aai-card');
      c.appendChild(el('div', null, 'Senaste AI-ändringen: "' + last.request + '"'));
      var row = el('div', 'row'), b = el('button', 'aai-btn', 'Ångra den');
      b.type = 'button';
      b.addEventListener('click', function () {
        if (!window.confirm('Ångra den senaste AI-ändringen? Sajten går tillbaka till hur den var innan.')) return;
        b.disabled = true;
        call('undo', {}).then(function () { c.remove(); add('aai-bot', 'Ändringen är ångrad. Sajten uppdateras om ungefär en minut.'); })
          .catch(function (err) { b.disabled = false; add('aai-err', err.message); });
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
      d.changes.forEach(function (x) { ul.appendChild(el('li', null, x.path + (x.created ? ' (ny fil)' : '') + ': +' + x.added + ' / −' + x.removed + ' rader')); });
      d.actions.forEach(function (a) { ul.appendChild(el('li', null, a)); });
      c.appendChild(ul);
      c.appendChild(el('small', null, 'Vill du justera något, skriv det nedan innan du publicerar.'));
      var row = el('div', 'row'), pub = el('button', 'aai-btn pri', 'Publicera'), drop = el('button', 'aai-btn', 'Släng');
      // Förhandsgranska: öppnar den ändrade sidan i en ny flik (sidor som ändrats, t.ex. index.html).
      d.changes.filter(function (x) { return /\.html$/i.test(x.path); }).forEach(function (x) {
        var pv = el('button', 'aai-btn', 'Förhandsgranska ' + (x.path === 'index.html' ? 'hemsidan' : x.path === 'nyheter/index.html' ? 'bloggen' : x.path));
        pv.type = 'button';
        pv.addEventListener('click', function () {
          var w = window.open('', '_blank');
          call('preview', { sessionId: sessionId, path: x.path }).then(function (r) {
            if (!w) { add('aai-err', 'Webbläsaren stoppade fliken. Tillåt popup-fönster för sajten.'); return; }
            var base = '/' + x.path.replace(/[^/]*$/, '');
            var html = r.html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '"><script>window.__fpPreview=1;</' + 'script>');
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
          add('aai-bot', 'Publicerat! ' + (r.files ? 'Sajten uppdateras om ungefär en minut, ladda sedan om sidan.' : 'Blogginläggen är uppdaterade.') + ' Ångrar du dig kan du ångra ändringen härifrån.');
          if (r.files) undoCard({ request: lastRequest });
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

    var lastRequest = '';
    function step(promise, wait) {
      return promise.then(function (d) {
        sessionId = d.sessionId;
        try { sessionStorage.setItem('fp_ai_session', sessionId); } catch (e) {}
        show(d);
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
      from = 0;
      step(call('start', { message: text, sessionId: sessionId }))
        .catch(function (err) { add('aai-err', err.message); })
        .then(function () { wait.remove(); setBusy(false); ta.focus(); });
    });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  }
})();
