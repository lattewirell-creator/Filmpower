// Recensioner som besökare skriver själva. Läggs in på en sida med:
//   <div data-fp-reviews></div>
//   <script src="/vendor/reviews.js" defer></script>
// Valfritt: data-title="Rubrik" och data-intro="Text under rubriken" på div:en.
// Admin ser en knapp för att ta bort recensioner. Sparas i databasen via /api/me?reviews=1.
(function () {
  var API = '/api/me?reviews=1';
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';

  function css() {
    if (document.getElementById('fpr-css')) return;
    var s = document.createElement('style');
    s.id = 'fpr-css';
    s.textContent = [
      '.fpr{display:grid;gap:1.4rem;color:var(--ink,#141614);font-family:var(--body,inherit)}',
      '.fpr-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1rem}',
      '.fpr-head h2{margin:0}.fpr-head p{margin:.3rem 0 0;color:var(--muted,#5d625b)}',
      '.fpr-avg{display:flex;align-items:center;gap:.6rem;font-weight:600}.fpr-avg small{color:var(--muted,#5d625b);font-weight:400}',
      '.fpr-stars{display:inline-flex;gap:.1rem}.fpr-stars svg{width:1.05rem;height:1.05rem;fill:var(--line,#d9dcd5)}.fpr-stars .on svg,.fpr-stars svg.on{fill:#e0a526}',
      '.fpr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:1rem}',
      '.fpr-card{border:1px solid var(--line,#e4e6e1);border-radius:16px;padding:1.1rem 1.2rem;display:grid;gap:.55rem;background:var(--bg,#fff);align-content:start}',
      '.fpr-card p{margin:0;white-space:pre-wrap;line-height:1.55}.fpr-card footer{display:flex;justify-content:space-between;align-items:center;gap:.5rem;color:var(--muted,#5d625b);font-size:.86rem}',
      '.fpr-card b{color:var(--ink,#141614)}.fpr-del{border:0;background:none;color:#b03a2e;cursor:pointer;font:inherit;font-size:.8rem;padding:0}',
      '.fpr-empty{color:var(--muted,#5d625b);margin:0}',
      '.fpr-form{border:1px solid var(--line,#e4e6e1);border-radius:18px;padding:1.2rem;display:grid;gap:.8rem;max-width:36rem;background:var(--soft,transparent)}',
      '.fpr-form h3{margin:0;font-size:1.1rem}.fpr-form label{display:grid;gap:.3rem;font-size:.9rem;font-weight:500}',
      '.fpr-form input,.fpr-form textarea{font:inherit;padding:.65rem .8rem;border:1px solid var(--line,#e4e6e1);border-radius:12px;background:var(--bg,#fff);color:inherit}',
      '.fpr-form textarea{min-height:6rem;resize:vertical}',
      '.fpr-pick{display:flex;gap:.2rem}.fpr-pick button{border:0;background:none;padding:.15rem;cursor:pointer;line-height:0}.fpr-pick svg{width:1.7rem;height:1.7rem;fill:var(--line,#d9dcd5);transition:fill .15s}.fpr-pick button.on svg{fill:#e0a526}',
      '.fpr-send{justify-self:start;border:0;border-radius:999px;padding:.75rem 1.4rem;background:var(--brand,#3d7a2c);color:var(--on-brand,#fff);font:600 .95rem var(--body,inherit);cursor:pointer}.fpr-send:disabled{opacity:.55;cursor:default}',
      '.fpr-msg{margin:0;font-size:.9rem}.fpr-msg.bad{color:#b03a2e}.fpr-msg.ok{color:var(--brand,#3d7a2c)}',
      '.fpr-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function stars(n) { var s = el('span', 'fpr-stars'); s.setAttribute('aria-label', n + ' av 5 stjärnor'); for (var i = 1; i <= 5; i++) { var w = el('span', i <= Math.round(n) ? 'on' : ''); w.innerHTML = STAR; s.appendChild(w); } return s; }
  function date(t) { return new Date(t).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' }); }

  var isAdmin = null;
  function admin() {
    if (isAdmin) return isAdmin;
    isAdmin = fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) { return Boolean(d.user && d.user.role === 'admin'); }).catch(function () { return false; });
    return isAdmin;
  }

  function mount(root) {
    if (root.__fpr) return;
    root.__fpr = true;
    css();
    root.classList.add('fpr');
    var head = el('div', 'fpr-head'), titles = el('div');
    titles.appendChild(el('h2', null, root.getAttribute('data-title') || 'Vad våra kunder säger'));
    titles.appendChild(el('p', null, root.getAttribute('data-intro') || 'Har du jobbat med oss? Berätta hur det gick.'));
    var avg = el('div', 'fpr-avg');
    head.appendChild(titles); head.appendChild(avg);
    var list = el('div', 'fpr-list');

    var form = el('form', 'fpr-form');
    form.innerHTML = '<h3>Skriv en recension</h3>' +
      '<div><span style="font-size:.9rem;font-weight:500">Betyg</span><div class="fpr-pick" role="radiogroup" aria-label="Betyg"></div></div>' +
      '<label>Namn<input name="name" maxlength="40" autocomplete="name" required></label>' +
      '<label>Din recension<textarea name="text" maxlength="600" required placeholder="Hur var det att jobba med Film Power?"></textarea></label>' +
      '<label class="fpr-hp" aria-hidden="true">Webbplats<input name="website" tabindex="-1" autocomplete="off"></label>' +
      '<button class="fpr-send" type="submit">Skicka recension</button><p class="fpr-msg" aria-live="polite"></p>';
    var pick = form.querySelector('.fpr-pick'), msg = form.querySelector('.fpr-msg'), btn = form.querySelector('.fpr-send'), rating = 0;
    for (var i = 1; i <= 5; i++) (function (n) {
      var b = el('button'); b.type = 'button'; b.innerHTML = STAR; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', n + ' stjärnor');
      b.addEventListener('click', function () { rating = n; [].forEach.call(pick.children, function (c, k) { c.classList.toggle('on', k < n); c.setAttribute('aria-checked', String(k === n - 1)); }); });
      pick.appendChild(b);
    })(i);

    root.innerHTML = '';
    root.appendChild(head); root.appendChild(list); root.appendChild(form);

    function render(d) {
      avg.innerHTML = '';
      if (d.count) { avg.appendChild(stars(d.average)); avg.appendChild(document.createTextNode(String(d.average).replace('.', ','))); avg.appendChild(el('small', null, '(' + d.count + (d.count === 1 ? ' recension)' : ' recensioner)'))); }
      list.innerHTML = '';
      if (!d.items.length) { list.appendChild(el('p', 'fpr-empty', 'Inga recensioner än. Bli först!')); return; }
      admin().then(function (adm) {
        d.items.forEach(function (r) {
          var c = el('article', 'fpr-card');
          c.appendChild(stars(r.rating));
          c.appendChild(el('p', null, r.text));
          var f = el('footer'); f.appendChild(el('b', null, r.name)); f.appendChild(el('span', null, date(r.createdAt)));
          if (adm) {
            var del = el('button', 'fpr-del', 'Ta bort'); del.type = 'button';
            del.addEventListener('click', function () {
              if (!window.confirm('Ta bort recensionen från ' + r.name + '?')) return;
              fetch(API + '&id=' + encodeURIComponent(r.id), { method: 'DELETE', credentials: 'same-origin', headers: { 'x-fp': '1' } }).then(load);
            });
            f.appendChild(del);
          }
          c.appendChild(f); list.appendChild(c);
        });
      });
    }
    function load() { return fetch(API + '&t=' + Date.now(), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(render).catch(function () { list.innerHTML = ''; list.appendChild(el('p', 'fpr-empty', 'Recensionerna kunde inte laddas just nu.')); }); }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.className = 'fpr-msg'; msg.textContent = '';
      if (!rating) { msg.className = 'fpr-msg bad'; msg.textContent = 'Välj hur många stjärnor du vill ge.'; return; }
      btn.disabled = true;
      fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-fp': '1' }, body: JSON.stringify({ name: form.elements.namedItem('name').value, text: form.elements.namedItem('text').value, rating: rating, website: form.elements.namedItem('website').value }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Något gick fel.'); return d; }); })
        .then(function () { form.reset(); rating = 0; [].forEach.call(pick.children, function (c) { c.classList.remove('on'); }); msg.className = 'fpr-msg ok'; msg.textContent = 'Tack för din recension!'; return load(); })
        .catch(function (err) { msg.className = 'fpr-msg bad'; msg.textContent = err.message; })
        .then(function () { btn.disabled = false; });
    });
    load();
  }

  function scan() { [].forEach.call(document.querySelectorAll('[data-fp-reviews]'), mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
