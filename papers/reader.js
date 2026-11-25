// The reader on each paper page. PDF.js draws the paper's own PDF, one page at a time as it comes near the screen, in the
// site's colours, with selectable text and working links. If PDF.js can't load, the browser's own PDF view takes over.
const BUILD = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const WIDEST = 880, BAR = 52, MIN_ZOOM = .6, MAX_ZOOM = 2.5, MOST_PIXELS = 16e6;

const pages = document.getElementById('pages'), file = pages.dataset.pdf, root = document.documentElement;
const at = document.getElementById('at'), of = document.getElementById('of'), level = document.getElementById('fit');
const dark = matchMedia('(prefers-color-scheme: dark)'), calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const div = cls => Object.assign(document.createElement('div'), { className: cls });

let pdfjs, doc, width0 = 612, zoom = 1, current = 1, sheets = [], later = 0, ticking = false;

const gutter = () => (root.clientWidth <= 640 ? 8 : 16);
const width = () => Math.round(Math.min(WIDEST, root.clientWidth - 2 * gutter()) * zoom);

function layout() {
  const w = width();
  pages.style.setProperty('--w', w + 'px');
  pages.style.setProperty('--scale-factor', w / width0);
  level.textContent = Math.round(zoom * 100) + '%';
}

// Colours come from the page's own tokens: the sheet is the site's paper, and in dark mode the ink is the site's too.
function colours() {
  const css = getComputedStyle(root), bg = css.getPropertyValue('--panel').trim(), fg = css.getPropertyValue('--ink').trim();
  return dark.matches ? { pageColors: { background: bg, foreground: fg } } : { background: bg };
}

async function draw(s) {
  const w = width(), run = ++s.run;
  if (s.task) s.task.cancel();
  s.page = s.page || await doc.getPage(s.n);
  if (run !== s.run || !s.near) return;
  const unit = s.page.getViewport({ scale: 1 });
  const ratio = Math.min(devicePixelRatio || 1, 3, Math.sqrt(MOST_PIXELS / (w * w * unit.height / unit.width)));
  const viewport = s.page.getViewport({ scale: w / unit.width * ratio });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = s.task = s.page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }), viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, ...colours(),
  });
  try { await task.promise; } catch (e) { if (e.name === 'RenderingCancelledException') return; throw e; }
  finally { if (s.task === task) s.task = null; }
  if (run !== s.run) return;
  if (s.canvas) s.canvas.replaceWith(canvas); else s.el.prepend(canvas);
  s.canvas = canvas;
  requestAnimationFrame(() => s.el.classList.add('ready'));
  layers(s);
}

function free(s) {
  s.run++;
  if (s.task) s.task.cancel();
  if (s.canvas) { s.canvas.width = 0; s.canvas.remove(); s.canvas = null; }
  s.el.classList.remove('ready');
}

// The text layer sits invisibly over the drawing so the paper can be selected, searched and read aloud.
async function layers(s) {
  if (s.layered) return;
  s.layered = true;
  const text = div('textLayer'), links = div('links'), page = s.page;
  s.el.append(text, links);
  await new pdfjs.TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
    container: text, viewport: page.getViewport({ scale: 1 }),
  }).render();
  text.append(div('endOfContent'));
  text.addEventListener('mousedown', () => text.classList.add('selecting'));
  addEventListener('mouseup', () => text.classList.remove('selecting'));

  const [x0, , x1, y1] = page.view, W = x1 - x0, H = y1 - page.view[1];
  for (const note of await page.getAnnotations({ intent: 'display' })) {
    if (note.subtype !== 'Link' || !note.rect || !(note.url || note.dest)) continue;
    const a = document.createElement('a'), [l, b, r, t] = note.rect;
    Object.assign(a.style, { left: (l - x0) / W * 100 + '%', top: (y1 - t) / H * 100 + '%', width: (r - l) / W * 100 + '%', height: (t - b) / H * 100 + '%' });
    if (note.url) { a.href = note.url; a.rel = 'noopener'; a.target = '_blank'; }
    else { a.href = '#'; a.addEventListener('click', e => { e.preventDefault(); go(note.dest); }); }
    links.append(a);
  }
}

// A reference or equation number jumps to its place; the browser's Back returns to where the reader was.
async function go(dest) {
  const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!d) return;
  const i = typeof d[0] === 'object' ? await doc.getPageIndex(d[0]) : d[0], s = sheets[i];
  const page = s.page = s.page || await doc.getPage(s.n), box = s.el.getBoundingClientRect();
  const kind = d[1] && d[1].name, y = kind === 'XYZ' ? d[3] : kind === 'FitH' || kind === 'FitBH' ? d[2] : null;
  const down = y == null ? 0 : (page.view[3] - y) * box.width / (page.view[2] - page.view[0]);
  history.replaceState({ y: scrollY }, '');
  history.pushState({}, '');
  scrollTo({ top: scrollY + box.top + down - BAR - 16, behavior: calm.matches || Math.abs(i + 1 - current) > 2 ? 'auto' : 'smooth' });
}
addEventListener('popstate', e => { if (e.state && e.state.y != null) scrollTo(0, e.state.y); });

function track() {
  ticking = false;
  const first = sheets[0].el.getBoundingClientRect(), gap = parseFloat(getComputedStyle(pages).rowGap) || 0;
  const n = clamp(Math.floor((innerHeight * .45 - first.top) / (first.height + gap)), 0, sheets.length - 1) + 1;
  if (n !== current) at.textContent = current = n;
  document.querySelector('.bar').style.setProperty('--p', clamp(scrollY / Math.max(1, root.scrollHeight - innerHeight), 0, 1));
}
function soon() { if (!ticking && sheets.length) { ticking = true; requestAnimationFrame(track); } }

function redraw() { clearTimeout(later); later = setTimeout(() => sheets.forEach(s => s.near && draw(s)), 160); }

// The bitmaps scale at once with CSS and are redrawn sharp when the zoom settles. The point under the cursor stays put.
function setZoom(z, cx = root.clientWidth / 2, cy = innerHeight / 2) {
  z = clamp(z, MIN_ZOOM, MAX_ZOOM);
  if (z === zoom) return;
  const top = pages.offsetTop, fy = (scrollY + cy - top) / pages.offsetHeight, fx = (scrollX + cx) / pages.offsetWidth;
  zoom = z;
  layout();
  scrollTo(fx * pages.offsetWidth - cx, fy * pages.offsetHeight + top - cy);
  redraw();
}

function native() {
  pages.className = 'native';
  pages.replaceChildren(Object.assign(document.createElement('iframe'), { src: file, title: document.title }));
  document.querySelectorAll('.count, .zoom').forEach(el => el.remove());
}

async function open() {
  pdfjs = await import(BUILD + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = BUILD + 'pdf.worker.min.mjs';
  doc = await pdfjs.getDocument({ url: file, isEvalSupported: false }).promise;
  const unit = (await doc.getPage(1)).getViewport({ scale: 1 });
  width0 = unit.width;
  pages.style.setProperty('--ar', unit.width / unit.height);
  layout();
  of.textContent = doc.numPages;

  const near = new IntersectionObserver(entries => entries.forEach(e => {
    const s = sheets[+e.target.dataset.i];
    s.near = e.isIntersecting;
    if (s.near) draw(s); else free(s);
  }), { rootMargin: '160% 0px' });
  pages.replaceChildren();
  for (let i = 0; i < doc.numPages; i++) {
    const el = div('sheet');
    el.dataset.i = i;
    el.setAttribute('aria-label', 'Page ' + (i + 1));
    pages.append(el);
    sheets.push({ el, n: i + 1, run: 0, near: false, task: null, page: null, canvas: null, layered: false });
    near.observe(el);
  }

  const start = /page=(\d+)/.exec(location.hash);
  if (start) sheets[clamp(+start[1], 1, sheets.length) - 1].el.scrollIntoView();
  track();
}

document.getElementById('in').addEventListener('click', () => setZoom(zoom * 1.2));
document.getElementById('out').addEventListener('click', () => setZoom(zoom / 1.2));
level.addEventListener('click', () => setZoom(1));
addEventListener('wheel', e => {
  if (!e.ctrlKey || !sheets.length) return;
  e.preventDefault();
  setZoom(zoom * Math.exp(-clamp(e.deltaY, -30, 30) * .01), e.clientX, e.clientY);
}, { passive: false });
addEventListener('scroll', soon, { passive: true });
addEventListener('resize', () => { if (sheets.length) { layout(); redraw(); soon(); } });
dark.addEventListener('change', () => { if (sheets.length) redraw(); });

document.querySelector('.copy').addEventListener('click', function () {
  navigator.clipboard.writeText(document.getElementById('bib').textContent).then(() => {
    this.textContent = 'Copied';
    setTimeout(() => { this.textContent = 'Copy BibTeX'; }, 1600);
  });
});

history.scrollRestoration = 'manual';
open().catch(native);
