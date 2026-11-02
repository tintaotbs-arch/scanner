/*
 * code128.js — bộ đọc vạch Code128 viết bằng JavaScript thuần, dùng cho iPhone
 * (Safari không có BarcodeDetector như Chrome Android). Không cần wasm, không tải gì thêm.
 *
 *   const r = MMTBCode128.decode(imageData, { lines: 24, vertical: false });
 *   const r = MMTBCode128.decode(imageData, { locate: true });   // ảnh chụp: tự tìm vùng vạch trước
 *   // r = { text, format: 'code_128', count } hoặc null
 *
 * Cách làm: lấy nhiều đường quét ngang (hoặc dọc) qua ảnh, mỗi đường đổi ra dãy độ rộng
 * vạch/khoảng trắng (cạnh tính tới phần lẻ của pixel), tìm mẫu Start rồi đọc từng ký tự
 * theo khoảng cách cạnh–cạnh (ít bị ảnh hưởng khi mực loang/ảnh nhòe), kiểm tra checksum.
 * count = số đường quét cho cùng một kết quả.
 */
(function (root) {
  'use strict';

  // 0..105: ký tự, 103/104/105 = Start A/B/C, 106 = Stop (6 phần tử đầu, còn 1 vạch 2 mô-đun).
  const PATTERNS = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 233111'
  ).split(' ').map(s => s.split('').map(Number));
  const EDGES = PATTERNS.map(p => [p[0] + p[1], p[1] + p[2], p[2] + p[3], p[3] + p[4]]);
  const STOP = 106;
  const MAX_ERR = 2.4;   // sai số tối đa của một ký tự (đơn vị mô-đun, cộng dồn)

  // So một nhóm 6 độ rộng với bảng mẫu; trả về { code, err, sum }.
  function matchSymbol(w, off) {
    let sum = 0;
    for (let k = 0; k < 6; k++) sum += w[off + k];
    if (!(sum > 0)) return null;
    const f = 11 / sum, n = [];
    for (let k = 0; k < 6; k++) n.push(w[off + k] * f);
    const e = [n[0] + n[1], n[1] + n[2], n[2] + n[3], n[3] + n[4]];
    let best = -1, bestErr = 1e9;
    for (let c = 0; c < PATTERNS.length; c++) {
      const p = PATTERNS[c], t = EDGES[c];
      let err = 0;
      for (let k = 0; k < 4; k++) err += Math.abs(e[k] - t[k]);
      for (let k = 0; k < 6; k++) err += 0.5 * Math.abs(n[k] - p[k]);
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return { code: best, err: bestErr, sum };
  }

  // Dãy mã ký tự (đã bỏ checksum) -> chuỗi.
  function codesToText(codes) {
    let set = codes[0] - 103, out = '', shift = -1;   // 0 = A, 1 = B, 2 = C
    for (let i = 1; i < codes.length; i++) {
      const c = codes[i], cur = shift >= 0 ? shift : set;
      shift = -1;
      if (cur === 2) {
        if (c < 100) out += (c < 10 ? '0' : '') + c;
        else if (c === 100) set = 1;
        else if (c === 101) set = 0;
        else if (c === 102) { if (out) out += '\u001d'; }
        else return null;
        continue;
      }
      if (c < 96) {
        out += cur === 0 ? String.fromCharCode(c < 64 ? c + 32 : c - 64) : String.fromCharCode(c + 32);
      } else if (c === 98) shift = cur === 0 ? 1 : 0;
      else if (c === 99) set = 2;
      else if (c === 100) { if (cur === 0) set = 1; }          // ở A: Code B; ở B: FNC4 (bỏ qua)
      else if (c === 101) { if (cur === 1) set = 0; }          // ở B: Code A; ở A: FNC4 (bỏ qua)
      else if (c === 102) { if (out) out += '\u001d'; }        // FNC1
      else if (c > 102) return null;                           // 96/97 = FNC3/FNC2: bỏ qua
    }
    return out;
  }

  // runs[0] là khoảng trắng, sau đó xen kẽ đen/trắng. Trả về chuỗi hoặc null.
  function decodeRuns(runs) {
    const n = runs.length;
    for (let i = 1; i + 6 < n; i += 2) {
      const st = matchSymbol(runs, i);
      if (!st || st.code < 103 || st.code > 105 || st.err > MAX_ERR) continue;
      let mod = st.sum / 11;
      if (i > 1 && runs[i - 1] < mod * 1.5) continue;       // cần một khoảng trắng trước Start
      const codes = [st.code];
      let j = i + 6, ok = false;
      while (j + 6 < n && codes.length < 80) {
        const m = matchSymbol(runs, j);
        if (!m || m.err > MAX_ERR) break;
        const r = m.sum / 11 / mod;
        if (r < 0.7 || r > 1.4) break;                       // cỡ mô-đun nhảy bất thường
        mod = m.sum / 11;
        if (m.code === STOP) {
          const last = runs[j + 6] / mod;                    // vạch cuối của Stop: 2 mô-đun
          ok = last > 1.2 && last < 3.2;
          break;
        }
        if (m.code >= 103) break;
        codes.push(m.code);
        j += 6;
      }
      if (!ok || codes.length < 3) continue;
      const check = codes.pop();
      let sum = codes[0];
      for (let k = 1; k < codes.length; k++) sum += k * codes[k];
      if (sum % 103 !== check) continue;
      const text = codesToText(codes);
      if (text) return text;
    }
    return null;
  }

  // Một đường độ sáng -> độ rộng các đoạn (đoạn đầu luôn là trắng), cạnh nội suy dưới pixel.
  function toRuns(g, thr) {
    const n = g.length, runs = [];
    let dark = false, last = 0;
    for (let x = 0; x < n; x++) {
      const d = g[x] < thr[x];
      if (d === dark) continue;
      let pos = x;
      if (x > 0) {                                           // vị trí cắt ngưỡng giữa x-1 và x
        const a = g[x - 1] - thr[x - 1], b = g[x] - thr[x];
        if (a !== b) pos = x - 1 + a / (a - b);
      }
      runs.push(pos - last);
      last = pos; dark = d;
    }
    runs.push(n - last);
    return runs;
  }

  // Max trong cửa sổ [x-r, x+r] cho mọi x, O(n) (chia khối, tiền tố/hậu tố).
  function slidingMax(a, r) {
    const n = a.length, w = 2 * r + 1, pre = new Float32Array(n), suf = new Float32Array(n), out = new Float32Array(n);
    for (let i = 0; i < n; i++) pre[i] = i % w === 0 ? a[i] : Math.max(pre[i - 1], a[i]);
    for (let i = n - 1; i >= 0; i--) suf[i] = (i === n - 1 || (i + 1) % w === 0) ? a[i] : Math.max(suf[i + 1], a[i]);
    for (let x = 0; x < n; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(n - 1, x + r);
      out[x] = Math.max(suf[lo], pre[hi]);
    }
    return out;
  }

  // Ngưỡng cục bộ: giữa min và max trong cửa sổ; chỗ phẳng (lề trắng) dùng ngưỡng chung.
  function localThreshold(g, radius, globalThr) {
    const n = g.length, neg = new Float32Array(n);
    for (let x = 0; x < n; x++) neg[x] = -g[x];
    const mx = slidingMax(g, radius), mn = slidingMax(neg, radius), thr = new Float32Array(n);
    for (let x = 0; x < n; x++) thr[x] = mx[x] + mn[x] > 28 ? (mx[x] - mn[x]) / 2 : globalThr;
    return thr;
  }

  // Cách 2 cho ảnh nhòe: cạnh = đỉnh độ dốc (vạch mảnh bị nhòe không chạm ngưỡng
  // nhưng vẫn có sườn rõ). Đỉnh nội suy parabol; giữ xen kẽ xuống-tối / lên-sáng.
  function gradientRuns(g, smooth) {
    const n = g.length;
    let s = g;
    if (smooth) {
      s = new Float32Array(n);
      for (let x = 0; x < n; x++) s[x] = (g[Math.max(0, x - 1)] + 2 * g[x] + g[Math.min(n - 1, x + 1)]) / 4;
    }
    const d = new Float32Array(n), ad = new Float32Array(n);
    for (let x = 1; x < n - 1; x++) { d[x] = (s[x + 1] - s[x - 1]) / 2; ad[x] = Math.abs(d[x]); }
    const loc = slidingMax(ad, Math.max(10, Math.round(n / 24)));
    const edges = [];   // { pos, sign, mag }
    for (let x = 2; x < n - 2; x++) {
      const a = ad[x];
      if (a < 2.5 || a < loc[x] * 0.18 || a < ad[x - 1] || a <= ad[x + 1]) continue;
      if ((d[x - 1] > 0) !== (d[x] > 0) && ad[x - 1] > 0) continue;
      const l = ad[x - 1], r = ad[x + 1], den = l - 2 * a + r;
      const pos = x + (den < 0 ? 0.5 * (l - r) / den : 0);
      const sign = d[x] < 0 ? -1 : 1;                        // -1: trắng -> đen
      const prev = edges[edges.length - 1];
      if (prev && prev.sign === sign) { if (a > prev.mag) { prev.pos = pos; prev.mag = a; } continue; }
      edges.push({ pos, sign, mag: a });
    }
    while (edges.length && edges[0].sign !== -1) edges.shift();
    const runs = [];
    let last = 0;
    for (const e of edges) { runs.push(e.pos - last); last = e.pos; }
    runs.push(n - last);
    return runs;
  }

  // Làm nét (unsharp mask) để cứu vạch mảnh trong ảnh nhòe.
  function sharpen(g, r) {
    const n = g.length, out = new Float32Array(n);
    let acc = 0;
    const pre = new Float32Array(n + 1);
    for (let x = 0; x < n; x++) { acc += g[x]; pre[x + 1] = acc; }
    for (let x = 0; x < n; x++) {
      const a = Math.max(0, x - r), b = Math.min(n, x + r + 1);
      out[x] = g[x] + 1.5 * (g[x] - (pre[b] - pre[a]) / (b - a));
    }
    return out;
  }

  // Thử mọi cách ngưỡng, cả hai chiều đọc.
  function decodeLine(g) {
    const s = Array.from(g).sort((a, b) => a - b);
    const lo = s[Math.floor(s.length * 0.05)], hi = s[Math.floor(s.length * 0.95)];
    if (hi - lo < 30) return null;                       // đường quét phẳng, không có vạch
    const gt = (lo + hi) / 2;
    const tries = [
      () => toRuns(g, localThreshold(g, Math.max(10, Math.round(g.length / 24)), gt)),
      () => gradientRuns(g, false),
      () => gradientRuns(g, true),
      () => toRuns(g, localThreshold(g, Math.max(20, Math.round(g.length / 10)), gt)),
      () => toRuns(g, new Float32Array(g.length).fill(gt)),
      () => gradientRuns(sharpen(g, 2), false),
      () => gradientRuns(sharpen(g, 3), false),
      () => toRuns(sharpen(g, 2), localThreshold(sharpen(g, 2), Math.max(10, Math.round(g.length / 24)), gt)),
    ];
    for (const make of tries) {
      const runs = make();
      if (runs.length < 30) continue;
      const rev = runs.slice().reverse();
      if (rev.length % 2 === 0) rev.unshift(0);            // đoạn đầu phải là trắng
      const t = decodeRuns(runs) || decodeRuns(rev);
      if (t) return t;
    }
    return null;
  }

  // Độ sáng trung bình 3 hàng (hoặc 3 cột) liền nhau.
  function lumaLine(img, idx, vertical) {
    const W = img.width, H = img.height, d = img.data;
    const len = vertical ? H : W, lim = vertical ? W : H;
    const g = new Float32Array(len);
    let cnt = 0;
    for (let o = -1; o <= 1; o++) {
      const k = idx + o;
      if (k < 0 || k >= lim) continue;
      cnt++;
      for (let x = 0; x < len; x++) {
        const p = (vertical ? x * W + k : k * W + x) * 4;
        g[x] += (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) / 256;
      }
    }
    for (let x = 0; x < len; x++) g[x] /= cnt;
    return g;
  }

  // Định vị (giống BarcodeDetector làm trước khi đọc): rà mọi hàng cách nhau `step` px, đếm số
  // lần độ dốc đổi chiều rõ rệt trong một đoạn dài 1/3 đường. Vùng vạch có nhiều cạnh dày đặc;
  // trả về các hàng điểm cao nhất (tem nhỏ trong ảnh lớn vẫn không bị đường quét đi trượt).
  function findCandidates(img, vertical, step, maxLines) {
    const W = img.width, H = img.height, d = img.data;
    const len = vertical ? H : W, lim = vertical ? W : H, span = Math.max(60, Math.round(len / 3));
    const g = new Float32Array(len), flips = [], cand = [];
    for (let idx = 1; idx < lim - 1; idx += step) {
      for (let x = 0; x < len; x++) {
        const p = (vertical ? x * W + idx : idx * W + x) * 4;
        g[x] = d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11;
      }
      flips.length = 0;
      let sign = 0;
      for (let x = 1; x < len - 1; x++) {
        const dv = g[x + 1] - g[x - 1];
        if (dv > 8 && sign <= 0) { sign = 1; flips.push(x); }
        else if (dv < -8 && sign >= 0) { sign = -1; flips.push(x); }
      }
      let best = 0;
      for (let a = 0, b = 0; b < flips.length; b++) {
        while (flips[b] - flips[a] > span) a++;
        if (b - a + 1 > best) best = b - a + 1;
      }
      if (best >= 24) cand.push({ idx, score: best });   // Code128 ngắn nhất cũng có hơn 30 cạnh
    }
    cand.sort((p, q) => q.score - p.score);
    return cand.slice(0, maxLines).map(c => c.idx);
  }

  function decode(img, opts) {
    opts = opts || {};
    const lines = opts.lines || 24, vertical = !!opts.vertical;
    const lim = vertical ? img.width : img.height;
    let order;
    if (opts.locate) {
      order = findCandidates(img, vertical, opts.step || 2, opts.maxLines || 160);
    } else {
      // Quét đều, từ giữa ra hai bên: tem thường nằm giữa khung.
      order = [];
      for (let i = 0; i < lines; i++) {
        const t = (i % 2 ? -1 : 1) * Math.ceil(i / 2) / lines;
        order.push(Math.round(lim * (0.5 + t * 0.9)));
      }
    }
    const tally = new Map();
    let best = null;
    for (const idx of order) {
      if (idx < 0 || idx >= lim) continue;
      const text = decodeLine(lumaLine(img, idx, vertical));
      if (!text) continue;
      const c = (tally.get(text) || 0) + 1;
      tally.set(text, c);
      if (!best || c > best.count) best = { text, format: 'code_128', count: c };
      if (opts.minAgree && c >= opts.minAgree) break;
    }
    return best;
  }

  const api = { decode, decodeLine, decodeRuns, codesToText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MMTBCode128 = api;
})(typeof self !== 'undefined' ? self : this);
