// 시험판 새 화면 공통 함수
const X = (() => {
  const cache = {};
  const get = u => cache[u] || (cache[u] = fetch(u, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(u); return r.json(); }));
  const eok = man => man == null ? "-" : (man / 10000).toFixed(2).replace(/\.?0+$/, "") + "억";
  const eok1 = man => man == null ? "-" : (Math.round(man / 1000) / 10).toString().replace(/\.0$/, "") + "억";
  const ym = v => { const s = String(v); return s.slice(2, 4) + "." + s.slice(4, 6); };
  const ymd = v => { const s = String(v); return s.slice(2, 4) + "." + s.slice(4, 6) + "." + s.slice(6, 8); };
  const pct = (v, d = 1) => v == null ? "-" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  // 색: 순차(파랑) / 발산(파랑-흰-빨강, 오르면 빨강)
  const mix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join(""); };
  const ramp = (stops, t) => { t = Math.max(0, Math.min(1, t)); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)); return mix(stops[i], stops[i + 1], t * n - i); };
  const SEQ = ["#eef3fc", "#bcd0f3", "#7ea5e6", "#3f73d4", "#1f4aa8", "#132e6e"];
  const DIV = ["#1f4aa8", "#7ea5e6", "#dfe6f2", "#f2b5ae", "#d9443a", "#9e231a"];
  const seq = t => ramp(SEQ, t), div = t => ramp(DIV, (t + 1) / 2);   // div: -1 ~ 1
  const inkOn = hex => { const p = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return (p[0] * .299 + p[1] * .587 + p[2] * .114) > 150 ? "#1d1f23" : "#fff"; };
  // 숫자 올라가는 모션
  function count(el, to, fmt, ms = 900) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = now => { const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3); el.textContent = fmt(from + (to - from) * e); if (t < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  // 작은 선 그래프 (series: [[x, y], ...]) — 선이 그려지는 모션
  function spark(series, o = {}) {
    const W = o.w || 320, H = o.h || 90, pad = o.pad || 6;
    const pts = series.filter(p => p[1] != null);
    if (pts.length < 2) return "";
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]).concat(o.extra || []);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X_ = x => pad + (x - x0) / (x1 - x0 || 1) * (W - pad * 2), Y_ = y => H - pad - (y - y0) / (y1 - y0 || 1) * (H - pad * 2);
    const d = pts.map((p, i) => (i ? "L" : "M") + X_(p[0]).toFixed(1) + "," + Y_(p[1]).toFixed(1)).join("");
    const lines = (o.lines || []).map(l => `<line x1="${pad}" x2="${W - pad}" y1="${Y_(l.y).toFixed(1)}" y2="${Y_(l.y).toFixed(1)}" stroke="${l.c}" stroke-dasharray="3 3" stroke-width="1"/><text x="${W - pad}" y="${(Y_(l.y) - 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${l.c}">${l.t}</text>`).join("");
    const area = o.fill ? `<path d="${d}L${X_(pts[pts.length - 1][0]).toFixed(1)},${H - pad}L${X_(pts[0][0]).toFixed(1)},${H - pad}Z" fill="${o.fill}" opacity=".5"/>` : "";
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">${area}${lines}` +
      `<path d="${d}" fill="none" stroke="${o.c || "#2a6fdb"}" stroke-width="${o.sw || 2}" stroke-linejoin="round" pathLength="1" class="draw"/>` +
      (o.dot !== false ? `<circle cx="${X_(last[0]).toFixed(1)}" cy="${Y_(last[1]).toFixed(1)}" r="3.5" fill="${o.c || "#2a6fdb"}"/>` : "") + `</svg>`;
  }
  // 전고점·전저점·현재 막대 (lo, hi: 축 범위)
  function dumbbell(peak, low, cur, lo, hi) {
    const P = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo || 1) * 100));
    const a = Math.min(peak, low), b = Math.max(peak, low);
    const cls = cur > peak ? "up" : cur < low ? "down" : "";
    return `<div class="db"><div class="rail"></div><div class="span" style="left:${P(a)}%;width:${P(b) - P(a)}%"></div>` +
      `<div class="lo" style="left:${P(low)}%"></div><div class="pk" style="left:${P(peak)}%"></div>` +
      (cur != null ? `<div class="cur ${cls}" style="left:${P(cur)}%"></div>` : "") + `</div>`;
  }
  const naver = (name, dong) => "https://m.land.naver.com/search/result/" + encodeURIComponent(name);
  const qs = () => Object.fromEntries(new URLSearchParams(location.search));
  return { get, eok, eok1, ym, ymd, pct, esc, store, seq, div, inkOn, count, spark, dumbbell, naver, qs };
})();
// 선 그리기 모션
(() => { const s = document.createElement("style"); s.textContent = `.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.1s cubic-bezier(.4,.1,.2,1) forwards}@keyframes draw{to{stroke-dashoffset:0}}@media (prefers-reduced-motion:reduce){.draw{animation:none;stroke-dashoffset:0}}`; document.head.appendChild(s); })();
