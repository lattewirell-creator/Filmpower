// Enkla byggstenar för admin-AI:n: hitta, byt ut och lägg till hela sektioner i en sida,
// och lägg till egen CSS och JavaScript. Det är lättare för en AI än att ersätta kod tecken för tecken.

const BLOCK = 'section|header|footer|aside|nav|main|dialog|article|form|div';

// Hittar ett element med id="key" (eller första section/header/footer/... med klassen key)
// och ger dess start och slut, med matchande sluttagg även när samma tagg finns inuti.
export function findElement(html, key) {
  const k = String(key || '').trim().replace(/^#/, '');
  if (!k) return null;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\sid=["']${esc}["'][^>]*>`, 'i').exec(html);
  if (!m) m = new RegExp(`<(section|header|footer|aside|nav|main|dialog)\\b[^>]*\\sclass=["'][^"']*\\b${esc}\\b[^"']*["'][^>]*>`, 'i').exec(html);
  if (!m) return null;
  const tag = m[1].toLowerCase(), start = m.index;
  if (/^(img|input|br|hr|meta|link|source)$/.test(tag)) return { tag, start, end: start + m[0].length };
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start + m[0].length;
  let depth = 1, t;
  while ((t = re.exec(html))) {
    if (t[1]) depth--; else if (!t[0].endsWith('/>')) depth++;
    if (depth === 0) return { tag, start, end: t.index + t[0].length };
  }
  return null;
}

const text = (s) => s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Karta över sidans delar: namn att använda med de andra verktygen, rubrik och en bit av texten.
export function pageMap(html) {
  const out = [];
  const re = new RegExp(`<(${BLOCK})\\b([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(html)) && out.length < 40) {
    const attrs = m[2];
    const id = (/\sid=["']([^"']+)["']/i.exec(attrs) || [])[1];
    const cls = (/\sclass=["']([^"']+)["']/i.exec(attrs) || [])[1] || '';
    const tag = m[1].toLowerCase();
    if (tag === 'div' && !id) continue;
    if (!id && !/^(section|header|footer|aside|nav|main)$/.test(tag)) continue;
    const key = id || cls.split(/\s+/)[0];
    if (!key) continue;
    const el = findElement(html, key);
    if (!el || el.start !== m.index) continue;
    const inner = html.slice(el.start, el.end);
    const h = (/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(inner) || [])[1];
    const line = html.slice(0, el.start).split('\n').length;
    out.push(`${key} (<${tag}>, rad ${line}, ${inner.length} tecken)${h ? ' rubrik: "' + text(h).slice(0, 60) + '"' : ''} | ${text(inner).slice(0, 90)}`);
  }
  const styles = (html.match(/<style\b/gi) || []).length, scripts = (html.match(/<script\b/gi) || []).length;
  return out.join('\n') + `\n(${styles} stilblock, ${scripts} skript. Egen CSS och JS läggs till med add_css och add_script.)`;
}

export function getSection(html, key) {
  const el = findElement(html, key);
  if (!el) throw new Error(`Hittar ingen del som heter "${key}". Kör page_map för att se namnen.`);
  const part = html.slice(el.start, el.end);
  return part.length > 6500 ? part.slice(0, 6500) + '\n[… delen är längre, använd read_file eller search för resten]' : part;
}

export function replaceSection(html, key, next) {
  const el = findElement(html, key);
  if (!el) throw new Error(`Hittar ingen del som heter "${key}". Kör page_map för att se namnen.`);
  if (!String(next || '').trim()) throw new Error('Ny HTML saknas. Använd remove_section för att ta bort.');
  return html.slice(0, el.start) + String(next).trim() + html.slice(el.end);
}

export function removeSection(html, key) {
  const el = findElement(html, key);
  if (!el) throw new Error(`Hittar ingen del som heter "${key}".`);
  return html.slice(0, el.start) + html.slice(el.end).replace(/^[ \t]*\n/, '');
}

export function insertSection(html, key, position, block) {
  const el = findElement(html, key);
  if (!el) throw new Error(`Hittar ingen del som heter "${key}". Kör page_map för att se namnen.`);
  const b = '\n' + String(block || '').trim() + '\n';
  if (position === 'before') return html.slice(0, el.start) + b.trimStart() + '\n' + html.slice(el.start);
  if (position === 'inside_end') { const close = html.lastIndexOf('</', el.end - 1); return html.slice(0, close) + b + html.slice(close); }
  return html.slice(0, el.end) + b + html.slice(el.end);
}

// AI:ns egen CSS och JavaScript samlas i egna block, så att de är lätta att hitta och ändra.
export function addCss(html, css) {
  const c = String(css || '').trim();
  if (!c) throw new Error('CSS saknas.');
  const m = /<style id="ai-css">([\s\S]*?)<\/style>/i.exec(html);
  if (m) return html.slice(0, m.index) + `<style id="ai-css">${m[1].trimEnd()}\n${c}\n</style>` + html.slice(m.index + m[0].length);
  const i = html.search(/<\/head>/i);
  if (i < 0) throw new Error('Sidan saknar </head>.');
  return html.slice(0, i) + `<style id="ai-css">\n${c}\n</style>\n` + html.slice(i);
}

export function addScript(html, js) {
  const c = String(js || '').trim();
  if (!c) throw new Error('JavaScript saknas.');
  const m = /<script id="ai-js">([\s\S]*?)<\/script>/i.exec(html);
  if (m) return html.slice(0, m.index) + `<script id="ai-js">${m[1].trimEnd()}\n;(function () {\n${c}\n})();\n</script>` + html.slice(m.index + m[0].length);
  const i = html.search(/<\/body>(?![\s\S]*<\/body>)/i);
  if (i < 0) throw new Error('Sidan saknar </body>.');
  return html.slice(0, i) + `<script id="ai-js">\n;(function () {\n${c}\n})();\n</script>\n` + html.slice(i);
}

// Byter en text överallt den står (eller bara första gången), t.ex. ett pris som finns på flera ställen.
export function replaceText(html, find, repl, all) {
  const f = String(find || '');
  if (!f) throw new Error('Texten att byta saknas.');
  const n = html.split(f).length - 1;
  if (!n) throw new Error(`"${f.slice(0, 60)}" finns inte på sidan. Sök med search först.`);
  if (n > 1 && !all) throw new Error(`"${f.slice(0, 60)}" finns ${n} gånger. Sätt all: true för att byta alla, eller ta med mer text.`);
  return { html: all ? html.split(f).join(String(repl ?? '')) : html.replace(f, () => String(repl ?? '')), count: all ? n : 1 };
}
