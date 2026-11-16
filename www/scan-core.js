/* Offline scan engine: edge detection + perspective fix + enhance (OpenCV.js), PDF and ZIP writers. No DOM needed. */
(function (root) {
  const DEFAULT = [[.04, .04], [.96, .04], [.96, .96], [.04, .96]];
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  function order(p) {
    const s = p.map(a => a[0] + a[1]), d = p.map(a => a[1] - a[0]);
    return [p[s.indexOf(Math.min(...s))], p[d.indexOf(Math.min(...d))], p[s.indexOf(Math.max(...s))], p[d.indexOf(Math.max(...d))]];
  }
  function make(cv) {
    const mat = im => { const m = new cv.Mat(im.height, im.width, cv.CV_8UC4); m.data.set(im.data); return m; };
    function detect(im) {
      const src = mat(im), small = new cv.Mat(), g = new cv.Mat(), e = new cv.Mat(), h = new cv.Mat(), cs = new cv.MatVector();
      const k = Math.min(1, 700 / Math.max(im.width, im.height)), kern = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.resize(src, small, new cv.Size(0, 0), k, k, cv.INTER_AREA);
      cv.cvtColor(small, g, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(g, g, new cv.Size(7, 7), 0);
      cv.Canny(g, e, 40, 140); cv.dilate(e, e, kern, new cv.Point(-1, -1), 2);
      cv.findContours(e, cs, h, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const list = []; for (let i = 0; i < cs.size(); i++) { const c = cs.get(i); list.push({ c, a: cv.contourArea(c) }); }
      list.sort((a, b) => b.a - a.a);
      let res = DEFAULT; const A = small.cols * small.rows;
      for (const { c, a } of list.slice(0, 6)) {
        if (a < .2 * A) break;
        const ap = new cv.Mat(); cv.approxPolyDP(c, ap, .02 * cv.arcLength(c, true), true);
        if (ap.rows === 4 && cv.isContourConvex(ap)) {
          const p = []; for (let i = 0; i < 4; i++) p.push([ap.data32S[i * 2] / small.cols, ap.data32S[i * 2 + 1] / small.rows]);
          ap.delete(); res = order(p); break;
        }
        ap.delete();
      }
      [src, small, g, e, h, kern].forEach(m => m.delete()); cs.delete();
      return res;
    }
    function enhance(m, mode) {
      const d = m.data, n = d.length;
      if (mode !== 'orig') {
        const g = new cv.Mat(), bg = new cv.Mat(), W = m.cols, H = m.rows, k = Math.max(15, (Math.max(W, H) / 60 | 0) | 1);
        cv.cvtColor(m, g, cv.COLOR_RGBA2GRAY); cv.dilate(g, bg, cv.Mat.ones(k, k, cv.CV_8U)); cv.GaussianBlur(bg, bg, new cv.Size(0, 0), k);
        const b = bg.data;
        for (let i = 0, j = 0; i < n; i += 4, j++) {
          const bl = b[j] + 1;
          if (mode === 'color') { for (let c = 0; c < 3; c++) d[i + c] = cl((d[i + c] / bl * 255 - 128) * 1.15 + 128); }
          else { const v = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / bl * 255, o = cl(mode === 'bw' ? (v - 150) * 2.4 + 205 : (v - 128) * 1.2 + 128); d[i] = d[i + 1] = d[i + 2] = o; }
        }
        g.delete(); bg.delete();
      }
      for (let i = 3; i < n; i += 4) d[i] = 255;
    }
    function process(im, fr, mode, maxSide) {
      const src = mat(im), w = im.width, h = im.height, p = order(fr.map(([x, y]) => [x * w, y * h])), dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      let W = Math.max(50, dd(p[2], p[3]) > dd(p[1], p[0]) ? dd(p[2], p[3]) : dd(p[1], p[0])), H = Math.max(50, Math.max(dd(p[1], p[2]), dd(p[0], p[3])));
      const k = maxSide ? Math.min(1, maxSide / Math.max(W, H)) : 1; W = Math.round(W * k); H = Math.round(H * k);
      const sp = cv.matFromArray(4, 1, cv.CV_32FC2, p.flat()), dp = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
      const M = cv.getPerspectiveTransform(sp, dp), out = new cv.Mat();
      cv.warpPerspective(src, out, M, new cv.Size(W, H), cv.INTER_CUBIC);
      enhance(out, mode);
      const res = { data: new Uint8ClampedArray(out.data), width: W, height: H };
      [src, sp, dp, M, out].forEach(m => m.delete());
      return res;
    }
    return { detect, process };
  }
  function pdf(pages) { // pages: [{bytes:Uint8Array(JPEG), w, h}] -> array of parts for a Blob
    const enc = new TextEncoder(), parts = [], xr = []; let off = 0;
    const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); off += b.length; };
    const obj = (n, f) => { xr[n] = off; add(n + ' 0 obj\n'); f(); add('\nendobj\n'); };
    add('%PDF-1.4\n'); obj(1, () => add('<</Type/Catalog/Pages 2 0 R>>'));
    obj(2, () => add('<</Type/Pages/Count ' + pages.length + '/Kids[' + pages.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ') + ']>>'));
    pages.forEach((p, i) => {
      const a = 3 + 3 * i, W = 595, H = Math.round(595 * p.h / p.w), c = `q ${W} 0 0 ${H} 0 0 cm /I Do Q`;
      obj(a, () => add(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Contents ${a + 1} 0 R/Resources<</XObject<</I ${a + 2} 0 R>>>>>>`));
      obj(a + 1, () => add(`<</Length ${c.length}>>\nstream\n${c}\nendstream`));
      obj(a + 2, () => { add(`<</Type/XObject/Subtype/Image/Width ${p.w}/Height ${p.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${p.bytes.length}>>\nstream\n`); add(p.bytes); add('\nendstream'); });
    });
    const n = 3 + 3 * pages.length, x = off; add(`xref\n0 ${n}\n0000000000 65535 f \n`);
    for (let i = 1; i < n; i++) add(String(xr[i]).padStart(10, '0') + ' 00000 n \n');
    add(`trailer\n<</Size ${n}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`); return parts;
  }
  function crc32(u) { let t = crc32.t; if (!t) { t = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } } let r = -1; for (let i = 0; i < u.length; i++) r = t[(r ^ u[i]) & 255] ^ (r >>> 8); return (r ^ -1) >>> 0; }
  function zip(files) { // [{name, bytes}] stored (no compression)
    const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
    for (const f of files) {
      const n = enc.encode(f.name), c = crc32(f.bytes), L = new DataView(new ArrayBuffer(30)), C = new DataView(new ArrayBuffer(46)), len = f.bytes.length;
      L.setUint32(0, 0x04034b50, true); L.setUint16(4, 20, true); L.setUint16(6, 0x800, true); L.setUint32(14, c, true); L.setUint32(18, len, true); L.setUint32(22, len, true); L.setUint16(26, n.length, true);
      parts.push(new Uint8Array(L.buffer), n, f.bytes);
      C.setUint32(0, 0x02014b50, true); C.setUint16(4, 20, true); C.setUint16(6, 20, true); C.setUint16(8, 0x800, true); C.setUint32(16, c, true); C.setUint32(20, len, true); C.setUint32(24, len, true); C.setUint16(28, n.length, true); C.setUint32(42, off, true);
      cd.push(new Uint8Array(C.buffer), n); off += 30 + n.length + len;
    }
    const cs = cd.reduce((a, b) => a + b.length, 0), E = new DataView(new ArrayBuffer(22));
    E.setUint32(0, 0x06054b50, true); E.setUint16(8, files.length, true); E.setUint16(10, files.length, true); E.setUint32(12, cs, true); E.setUint32(16, off, true);
    return [...parts, ...cd, new Uint8Array(E.buffer)];
  }
  const api = { make, pdf, zip };
  if (typeof module !== 'undefined') module.exports = api; else root.ScanCore = api;
})(typeof self !== 'undefined' ? self : this);
