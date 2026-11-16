const $ = id => document.getElementById(id), app = $('app');
const FILTERS = [['bw', 'مستند'], ['color', 'ألوان'], ['gray', 'رمادي'], ['orig', 'الأصل']];
const spin = '<i class="fa-solid fa-spinner fa-spin ml-2"></i>';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = ms => new Date(ms).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
const fname = t => t.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document';
const toast = m => { const t = $('toast'); t.textContent = m; t.style.opacity = 1; clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = 0, 2400); };

// ---------- OpenCV engine ----------
let CORE;
const cvReady = new Promise(res => {
  $('boot').classList.remove('hidden');
  const s = document.createElement('script'); s.src = 'vendor/opencv.js';
  s.onload = async () => { const cv = window.cv; while (!cv.Mat) await new Promise(r => setTimeout(r, 60)); CORE = Object.assign(ScanCore.make(cv), { pdf: ScanCore.pdf, zip: ScanCore.zip }); $('boot').classList.add('hidden'); res(); };
  document.head.appendChild(s);
});

// ---------- storage (IndexedDB) ----------
const idb = new Promise(r => { const q = indexedDB.open('scanner-offline', 1); q.onupgradeneeded = () => q.result.createObjectStore('docs', { keyPath: 'id' }); q.onsuccess = () => r(q.result); });
const store = async m => (await idb).transaction('docs', m).objectStore('docs');
const rq = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = no; });
const allDocs = async () => (await rq((await store('readonly')).getAll())).sort((a, b) => b.id - a.id);
const getDoc = async id => rq((await store('readonly')).get(id));
const putDoc = async d => rq((await store('readwrite')).put(d));
const delDoc = async id => rq((await store('readwrite')).delete(id));
let seq = 0; const newId = () => Date.now() * 100 + (seq++ % 100);

// ---------- helpers ----------
const urls = []; const url = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };
async function toIm(blob) {
  const bm = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0); bm.close && bm.close(); return x.getImageData(0, 0, c.width, c.height);
}
function toBlob(im, q = .88) {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').putImageData(new ImageData(im.data, im.width, im.height), 0, 0);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
async function saveBlob(blob, name) {
  const C = window.Capacitor;
  if (C && C.isNativePlatform && C.isNativePlatform()) {
    try {
      const b64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(blob); });
      const { uri } = await C.Plugins.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
      await C.Plugins.Share.share({ title: name, url: uri, dialogTitle: 'حفظ / مشاركة' });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('تعذر الحفظ'); }
    return;
  }
  const f = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const shell = ({ back, title, actions = '', body }) => `<header class="glass sticky top-0 z-30 border-b border-slate-200/60" style="padding-top:env(safe-area-inset-top)"><div class="max-w-3xl mx-auto flex items-center gap-3 px-4 h-14">${back ? `<a href="${back}" class="-mr-2 p-2 rounded-full hover:bg-slate-100"><i class="fa-solid fa-arrow-right text-lg"></i></a>` : ''}<h1 class="flex-1 text-lg font-extrabold truncate">${title}</h1>${actions}</div></header><main class="max-w-3xl mx-auto px-4 pt-5 pb-36">${body}</main>`;
const bar = inner => `<div class="fixed inset-x-0 bottom-0 z-40 glass border-t border-slate-200/60 px-4 pt-3" style="padding-bottom:calc(.75rem + env(safe-area-inset-bottom))"><div class="max-w-3xl mx-auto flex gap-2.5">${inner}</div></div>`;

// ---------- router ----------
async function route() {
  urls.splice(0).forEach(URL.revokeObjectURL);
  ['ed', 'sheet', 'viewer'].forEach(i => $(i).classList.add('hidden'));
  const [, r, a] = location.hash.slice(1).split('/');
  try { if (r === 'doc') await docView(+a); else if (r === 'scan') scanView(a ? +a : 0); else await home(); } catch (e) { console.error(e); app.innerHTML = '<p class="p-8 text-center text-slate-500">حصل خطأ</p>'; }
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- home ----------
let HD = [];
const card = d => { const n = d.pages.length; return `<a href="#/doc/${d.id}" class="group relative block active:scale-[.97] transition">${n > 1 ? '<div class="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-3xl bg-slate-300/70"></div>' : ''}<div class="relative bg-white rounded-3xl overflow-hidden shadow-md shadow-slate-900/5 ring-1 ring-slate-900/5">${d.th ? `<img src="${d.th}" class="w-full aspect-[3/4] object-cover bg-slate-100">` : '<div class="aspect-[3/4] bg-slate-100 grid place-items-center text-4xl"><i class="fa-solid fa-file-lines text-slate-300"></i></div>'}<span class="absolute top-3 right-3 bg-slate-900/70 backdrop-blur text-white text-xs font-bold rounded-full px-2.5 py-1">${n} ص</span><div class="p-3.5"><p class="font-bold text-sm truncate">${esc(d.title)}</p><p class="text-xs text-slate-400 mt-0.5">${fmt(d.created)}</p></div></div></a>`; };
function grid(q) { const l = HD.filter(d => d.title.includes(q)); return l.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5">${l.map(card).join('')}</div>` : `<div class="text-center text-slate-400 mt-20 leading-9"><div class="text-6xl mb-2"><i class="fa-solid fa-folder-open text-slate-300"></i></div>${q ? 'مفيش نتايج للبحث' : 'مفيش ورق متسكن لسه<br>دوس على "مسح جديد" وابدأ'}</div>`; }
function search(v) { $('gr').innerHTML = grid(v.trim()); }
async function home() {
  HD = await allDocs(); HD.forEach(d => d.th = d.pages[0] ? url(d.pages[0].blob) : '');
  const pg = HD.reduce((a, d) => a + d.pages.length, 0);
  app.innerHTML = shell({ title: 'ماسح الورق', body: `<section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-400 via-sky-500 to-blue-600 text-white p-6 shadow-xl shadow-sky-900/10"><div class="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-white/10"></div><div class="absolute -bottom-16 right-10 w-52 h-52 rounded-full bg-white/10"></div><p class="relative text-sky-100 text-sm">مكتبتك</p><h2 class="relative text-2xl font-extrabold mt-1">ورقك محفوظ وبعيد عن التلف <i class="fa-solid fa-book-open mr-1"></i></h2><div class="relative flex gap-3 mt-5"><div class="flex-1 bg-white/15 rounded-2xl px-4 py-3 backdrop-blur"><div class="text-2xl font-extrabold">${HD.length}</div><div class="text-xs text-sky-50">مستند</div></div><div class="flex-1 bg-white/15 rounded-2xl px-4 py-3 backdrop-blur"><div class="text-2xl font-extrabold">${pg}</div><div class="text-xs text-sky-50">صفحة</div></div></div></section>
  <input oninput="search(this.value)" placeholder="ابحث باسم المستند..." class="mt-5 w-full rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm outline-none focus:ring-4 focus:ring-sky-500/20 focus:border-sky-500 transition"><div id="gr">${grid('')}</div>
  <div class="fixed inset-x-0 bottom-0 z-40 pointer-events-none" style="padding-bottom:calc(1.25rem + env(safe-area-inset-bottom))"><a href="#/scan" class="pointer-events-auto mx-auto flex items-center justify-center gap-3 w-[min(92%,420px)] rounded-full bg-slate-900 text-white font-bold text-lg py-4 shadow-2xl shadow-slate-900/30 active:scale-95 transition"><i class="fa-solid fa-camera text-xl"></i>مسح جديد</a></div>` });
}

// ---------- document ----------
let CD;
async function docView(id) {
  CD = await getDoc(id); if (!CD) { location.hash = '#/'; return; }
  const n = CD.pages.length;
  app.innerHTML = shell({ back: '#/', title: `<span id="ttl">${esc(CD.title)}</span>`, actions: '<button onclick="ren()" class="p-2 rounded-full hover:bg-slate-100"><i class="fa-solid fa-pen"></i></button><button onclick="dd()" class="p-2 rounded-full hover:bg-red-50"><i class="fa-solid fa-trash-can text-red-500"></i></button>',
    body: `<p class="text-sm text-slate-500 mb-4">${n} صفحة · ${fmt(CD.created)}</p><div class="grid grid-cols-2 sm:grid-cols-3 gap-4">${CD.pages.map((p, i) => `<div class="relative bg-white rounded-3xl overflow-hidden shadow-md shadow-slate-900/5 ring-1 ring-slate-900/5"><img src="${url(p.blob)}" onclick="view(this.src)" class="w-full aspect-[3/4] object-cover"><span class="absolute bottom-3 right-3 bg-slate-900/70 backdrop-blur text-white text-xs font-bold rounded-full w-7 h-7 grid place-items-center">${i + 1}</span><button onclick="dp(${i})" class="absolute top-3 left-3 bg-white/90 text-red-600 rounded-full w-8 h-8 shadow"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="col-span-full text-center text-slate-400 mt-16">المستند فاضي</p>'}</div>`
      + bar(`<a href="#/scan/${CD.id}" class="flex-1 text-center bg-sky-600 text-white font-bold rounded-2xl py-3.5 active:scale-95 transition"><i class="fa-solid fa-plus ml-1.5"></i> صفحات</a>${n ? '<button onclick="expPdf()" class="flex-1 bg-slate-900 text-white font-bold rounded-2xl py-3.5 active:scale-95 transition"><i class="fa-solid fa-file-pdf ml-1.5"></i> PDF</button><button onclick="expImgs()" class="flex-1 bg-white ring-1 ring-slate-300 font-bold rounded-2xl py-3.5 active:scale-95 transition"><i class="fa-solid fa-images ml-1.5"></i> صور</button>' : ''}`) });
}
function view(s) { $('vimg').src = s; $('viewer').classList.remove('hidden'); }
async function ren() { const t = prompt('اسم المستند', CD.title); if (t && t.trim()) { CD.title = t.trim().slice(0, 200); await putDoc(CD); $('ttl').textContent = CD.title; toast('تم تغيير الاسم'); } }
async function dd() { if (confirm('حذف المستند كله؟')) { await delDoc(CD.id); location.hash = '#/'; } }
async function dp(i) { if (!confirm('حذف الصفحة؟')) return; CD.pages.splice(i, 1); CD.pages.length ? await putDoc(CD) : await delDoc(CD.id); CD.pages.length ? docView(CD.id) : location.hash = '#/'; }
async function expPdf() {
  toast('جاري إنشاء PDF...'); const pg = [];
  for (const p of CD.pages) pg.push({ bytes: new Uint8Array(await p.blob.arrayBuffer()), w: p.w, h: p.h });
  await cvReady; await saveBlob(new Blob(CORE.pdf(pg), { type: 'application/pdf' }), fname(CD.title) + '.pdf');
}
async function expImgs() {
  await cvReady; if (CD.pages.length === 1) return saveBlob(CD.pages[0].blob, fname(CD.title) + '.jpg');
  const fs = []; for (let i = 0; i < CD.pages.length; i++) fs.push({ name: String(i + 1).padStart(2, '0') + '.jpg', bytes: new Uint8Array(await CD.pages[i].blob.arrayBuffer()) });
  await saveBlob(new Blob(CORE.zip(fs), { type: 'application/zip' }), fname(CD.title) + '.zip');
}

// ---------- scan session ----------
let S = {};
const IC = 'shrink-0 px-4 py-2 rounded-full text-sm font-bold transition ', ON = 'bg-slate-900 text-white', OFF = 'bg-white ring-1 ring-slate-200 text-slate-600';
function scanView(doc) {
  S = { pages: [], filt: 'bw', mode: 'pdf', cur: -1, q: Promise.resolve(), doc };
  app.innerHTML = shell({ back: doc ? '#/doc/' + doc : '#/', title: 'مسح جديد', actions: '<span id="cnt" class="hidden bg-sky-100 text-sky-700 text-sm font-bold rounded-full px-3 py-1"></span>',
    body: `<section id="empty" class="text-center pt-10"><div class="mx-auto w-28 h-28 rounded-[2rem] bg-gradient-to-br from-sky-400 to-blue-600 grid place-items-center text-5xl shadow-xl shadow-sky-600/30"><i class="fa-solid fa-layer-group text-white"></i></div><h2 class="text-2xl font-extrabold mt-6">صوّر ورقة ورا ورقة</h2><p class="text-slate-500 mt-2 leading-7">الورقة بتتقص وتتظبط تلقائي،<br>وفي الآخر تحفظهم كلهم في ملف واحد</p>
    <button onclick="cam.click()" class="mt-8 w-full bg-slate-900 text-white font-bold rounded-2xl py-4 text-lg shadow-xl active:scale-95 transition"><i class="fa-solid fa-camera ml-2"></i> افتح الكاميرا</button><button onclick="gal.click()" class="mt-3 w-full bg-white ring-1 ring-slate-200 font-bold rounded-2xl py-4 text-lg active:scale-95 transition"><i class="fa-solid fa-images ml-2"></i> اختار صور من المعرض</button></section>
    <section id="tray" class="hidden"><div id="chips" class="flex items-center gap-2 overflow-x-auto pb-3"></div><div id="grid" class="grid grid-cols-2 sm:grid-cols-3 gap-4"></div></section>` })
    + `<div id="dock" class="hidden">${bar('<button onclick="cam.click()" class="flex-1 bg-white ring-1 ring-slate-300 font-bold rounded-2xl py-3.5 active:scale-95 transition"><i class="fa-solid fa-camera ml-1.5"></i> صفحة كمان</button><button onclick="gal.click()" class="w-14 bg-white ring-1 ring-slate-300 rounded-2xl active:scale-95 transition"><i class="fa-solid fa-images"></i></button><button onclick="openFinish()" class="flex-[1.3] bg-sky-600 text-white font-bold rounded-2xl py-3.5 shadow-lg shadow-sky-600/30 active:scale-95 transition">إنهاء وحفظ <i class="fa-solid fa-check mr-1.5"></i></button>')}</div>`;
  render();
}
for (const i of [$('cam'), $('gal')]) i.onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) await addFile(f); };
async function addFile(f) {
  const bm = await createImageBitmap(f, { imageOrientation: 'from-image' }), k = Math.min(1, 2200 / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas'); c.width = bm.width * k | 0; c.height = bm.height * k | 0; c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  const p = { blob: await new Promise(r => c.toBlob(r, 'image/jpeg', .9)), pts: null, prev: null, filt: null, err: false };
  S.pages.push(p); render(); S.q = S.q.then(() => proc(p));
}
async function proc(p) {
  if (p.prev) URL.revokeObjectURL(p.prev); p.prev = null; p.err = false; render();
  try { await cvReady; const im = await toIm(p.blob); if (!p.pts) p.pts = CORE.detect(im); p.prev = URL.createObjectURL(await toBlob(CORE.process(im, p.pts, p.filt || S.filt, 900), .8)); }
  catch (e) { console.error(e); p.err = true; }
  render();
}
function render() {
  if (!$('grid')) return; const n = S.pages.length;
  $('empty').classList.toggle('hidden', n > 0); $('tray').classList.toggle('hidden', !n); $('dock').classList.toggle('hidden', !n);
  $('cnt').classList.toggle('hidden', !n); $('cnt').textContent = n + ' صفحة';
  $('chips').innerHTML = '<span class="text-sm text-slate-400 shrink-0">الفلتر:</span>' + FILTERS.map(([k, t]) => `<button onclick="setFilt('${k}')" class="${IC}${k === S.filt ? ON : OFF}">${t}</button>`).join('');
  $('grid').innerHTML = S.pages.map((p, i) => `<div class="relative bg-white rounded-3xl overflow-hidden shadow-md shadow-slate-900/5 ring-1 ring-slate-900/5">
   ${p.prev ? `<img src="${p.prev}" class="w-full aspect-[3/4] object-cover bg-slate-100" onclick="openEd(${i})">` : `<div class="aspect-[3/4] bg-slate-100 grid place-items-center text-slate-400 text-sm ${p.err ? '' : 'animate-pulse'}">${p.err ? '<i class="fa-solid fa-triangle-exclamation ml-1"></i> خطأ' : '<i class="fa-solid fa-spinner fa-spin ml-1"></i> جاري التجهيز'}</div>`}
   <span class="absolute top-3 right-3 bg-slate-900/75 backdrop-blur text-white text-xs font-bold rounded-full w-7 h-7 grid place-items-center">${i + 1}</span>
   <button onclick="rm(${i})" class="absolute top-3 left-3 bg-white/90 text-red-600 rounded-full w-8 h-8 shadow"><i class="fa-solid fa-xmark"></i></button>
   <div class="flex border-t border-slate-100 text-slate-600 text-lg"><button onclick="mv(${i},-1)" class="flex-1 py-2 disabled:opacity-25" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button><button onclick="openEd(${i})" class="flex-[1.4] py-2 text-sm font-bold text-sky-700">تعديل</button><button onclick="mv(${i},1)" class="flex-1 py-2 disabled:opacity-25" ${i === n - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button></div></div>`).join('');
}
function setFilt(k) { S.filt = k; S.pages.forEach(p => p.filt = null); render(); S.pages.forEach(p => S.q = S.q.then(() => proc(p))); }
function rm(i) { const [p] = S.pages.splice(i, 1); p.prev && URL.revokeObjectURL(p.prev); render(); }
function mv(i, d) { const j = i + d; [S.pages[i], S.pages[j]] = [S.pages[j], S.pages[i]]; render(); }

// ---------- editor ----------
let tmp = null;
const hs = [0, 1, 2, 3].map(i => {
  const h = document.createElement('div'); h.className = 'absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-sky-500/90 border-[3px] border-white shadow-xl touch-none';
  h.onpointerdown = e => { e.preventDefault(); h.setPointerCapture(e.pointerId);
    h.onpointermove = ev => { const r = $('pic').getBoundingClientRect(); tmp.pts[i] = [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))]; drawEd(); };
    h.onpointerup = () => h.onpointermove = null; };
  $('stage').appendChild(h); return h;
});
function drawEd() {
  $('poly').setAttribute('points', tmp.pts.map(p => p[0] * 100 + ',' + p[1] * 100).join(' '));
  hs.forEach((h, i) => { h.style.left = tmp.pts[i][0] * 100 + '%'; h.style.top = tmp.pts[i][1] * 100 + '%'; });
  $('edchips').innerHTML = FILTERS.map(([k, t]) => `<button onclick="tmp.filt='${k}';drawEd()" class="${IC}${k === (tmp.filt || S.filt) ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-300'}">${t}</button>`).join('');
}
function openEd(i) { const p = S.pages[i]; if (!p.pts) return; S.cur = i; tmp = { pts: p.pts.map(x => [...x]), filt: p.filt }; $('pic').src = url(p.blob); $('ed').classList.remove('hidden'); drawEd(); }
function closeEd() { $('ed').classList.add('hidden'); }
function doneEd() { const p = S.pages[S.cur]; p.pts = tmp.pts; p.filt = tmp.filt; closeEd(); S.q = S.q.then(() => proc(p)); }

// ---------- finish & save ----------
function openFinish() {
  if (S.pages.some(p => !p.prev)) return toast('استنى لحد ما كل الصفحات تجهز');
  const n = S.pages.length; $('sn').textContent = n; $('nameBox').classList.toggle('hidden', !!S.doc);
  if (!$('nm').value) $('nm').value = 'مستند ' + new Date().toLocaleDateString('ar-EG');
  const M = [['pdf', 'file-pdf', 'ملف PDF واحد', n + ' صفحات في ملف'], ['sep', 'images', 'كل صفحة لوحدها', n + ' ملفات منفصلة']];
  $('modes').innerHTML = M.map(([k, ic, t, s]) => `<button onclick="S.mode='${k}';openFinish()" class="text-right rounded-2xl p-4 border-2 transition ${S.mode === k ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}"><div class="text-2xl"><i class="fa-solid fa-${ic} text-sky-600"></i></div><div class="font-bold mt-1">${t}</div><div class="text-xs text-slate-500">${s}</div></button>`).join('');
  $('modes').classList.toggle('hidden', n < 2); const b = $('saveBtn'); b.disabled = false; b.textContent = 'حفظ'; $('sheet').classList.remove('hidden');
}
function closeFinish() { $('sheet').classList.add('hidden'); }
async function finish() {
  const b = $('saveBtn'), n = S.pages.length, name = $('nm').value.trim() || 'مستند', sep = !S.doc && n > 1 && S.mode === 'sep'; b.disabled = true;
  try {
    await cvReady; const pages = [];
    for (let i = 0; i < n; i++) { b.innerHTML = `${spin} بيحفظ ${i + 1} / ${n}`; const p = S.pages[i], o = CORE.process(await toIm(p.blob), p.pts, p.filt || S.filt, 0); pages.push({ blob: await toBlob(o), w: o.width, h: o.height }); await new Promise(r => setTimeout(r)); }
    if (S.doc) { const d = await getDoc(S.doc); d.pages.push(...pages); await putDoc(d); location.hash = '#/doc/' + S.doc; }
    else if (sep) { for (let i = 0; i < n; i++) await putDoc({ id: newId(), title: name + ' ' + (i + 1), created: Date.now(), pages: [pages[i]] }); location.hash = '#/'; }
    else { const id = newId(); await putDoc({ id, title: name, created: Date.now(), pages }); location.hash = '#/doc/' + id; }
  } catch (e) { console.error(e); toast('حصل خطأ أثناء الحفظ'); b.disabled = false; b.textContent = 'حفظ'; }
}

route();
if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) navigator.serviceWorker.register('sw.js').catch(() => {});
