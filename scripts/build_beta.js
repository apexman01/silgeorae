#!/usr/bin/env node
/*
 * 시험판 새 기능(지도 홈·상승/하락·내 집 진단·시세 그룹)용 자료 만들기
 *
 *   node scripts/build_beta.js            → docs/beta/data/x/ (시험판)
 *   node scripts/build_beta.js --out docs/data/x --no-patch   (정식 반영 시)
 *
 * 만드는 파일 (docs/data/·summary/ 형식은 건드리지 않음, 새 파일만)
 *  - map.json  : 서울 25개 구 SVG 경계 (data/geo/seoul_gu_2013.geojson → 화면 좌표)
 *  - gu.json   : 구별 84㎡ 월별 시세(3개월 이동 중간값, 매매·전세 신규) + 전고점·전저점·회복률·전세가율
 *  - cx.json   : 생활권별 대표 단지(시세 요약 파일과 같은 단지) 59·84㎡ 지표
 *       시세 = 4층 이상 매매(분양권·입주권 포함) 최근 12개월 중 최근 3건 중간값 (4층 이상이 없으면 전체 층)
 *       전고점 = 2021~2022년 일반 매매 최고가, 전저점 = 전고점 이후 일반 매매 최저가(2건 이상이면 가장 낮은 1건은 급매로 보고 제외)
 *         분양권·입주권은 분양가·조합원 가격이라 사이클 판단에서 뺌. 판단 못 하면 사이클 = {판정:"불가", 이유}
 *         이유: 신축(21~22 일반 매매 2건 미만 + 분양권 거래 있음/2021년 이후 준공) · 입주권(거래의 절반 이상이 입주권)
 *               · 신축입주권(입주권 위주였지만 이미 준공: 준공(사용승인) 연월 ≤ 자료 기준월이거나 일반 매매가 있음)
 *                 준공 연월 = data/master/kapt_usedate.json(K-apt 자동) → data/master/usedate.json(손 확인) 순. 연도만 알면 그 해가 기준월보다 앞일 때만 준공으로 봄
 *               · 거래부족(구축인데 21~22 일반 매매 2건 미만, 또는 전고점 뒤 거래 없음) · 저≥고
 *  - 마지막 달(자료의 마지막 월)은 신고기한(30일)이 남아 '잠정'. 구 대표 숫자(현재·회복률·전세가율)는 그 직전 달(확정월) 기준
 *       전세 = 신규 계약 4층 이상 최근 6개월 중간값(3건 미만이면 12개월, 같은 보증금 3건 이상 반복=임대 물량 제외)
 *       월별 = 월별 중간값 [연월, 만원] (그래프용)
 *  - 생활권 서열 2가지: 대장(84㎡ 12개월 최고가 중 최대) / 중간(대표 단지 84㎡ 시세의 중간값)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(ROOT, argVal("--out") || "docs/beta/data/x");
const USE_PATCH = !args.includes("--no-patch");
const SUMMARY = path.resolve(ROOT, USE_PATCH ? "docs/beta/data/summary" : "docs/data/summary");

const AREAS = { "84": [80, 90], "59": [55, 66] };
const norm = s => String(s).replace(/\s+/g, "").toLowerCase();
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
function runInto(win, file) { const ctx = { window: win, console }; vm.createContext(ctx); vm.runInContext(read(file), ctx); }
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const key = r => r[2] * 100 + r[3];

const win = {};
runInto(win, "docs/data/index.js");
runInto(win, "docs/lifezones.js");
if (USE_PATCH && fs.existsSync(path.join(ROOT, "docs/beta/lifezones_patch.js"))) runInto(win, "docs/beta/lifezones_patch.js");
const INDEX = win.DATA_INDEX, LZ = win.LIFEZONES;
const MASTER = {}, MASTER_BY_ZONE = {};   // 단지 마스터 (id·세대수) · 생활권별 목록(가격순 선정 결과, build_master.js가 순서까지 정함)
const MASTER_FILE = path.join(ROOT, "docs/beta/data/master/complexes.json");
if (USE_PATCH && fs.existsSync(MASTER_FILE)) JSON.parse(fs.readFileSync(MASTER_FILE, "utf8")).단지.forEach(x => {
  MASTER[x.구 + "|" + x.생활권이름 + "|" + x.이름] = x;
  (MASTER_BY_ZONE[x.구 + "|" + x.생활권이름] = MASTER_BY_ZONE[x.구 + "|" + x.생활권이름] || []).push(x);
});
const months = INDEX.months, lastYm = months[months.length - 1];
const idxOf = {}; months.forEach((m, i) => idxOf[m] = i);
const from6 = months[Math.max(0, months.length - 6)], from12 = months[Math.max(0, months.length - 12)];
const PEAK_FROM = 202101, PEAK_TO = 202212;
// 준공(사용승인) 연월 YYYYMM: K-apt 자동(전체 날짜) → 손 확인 파일(예정 제외)
const USE_YM = {};
{
  const rd = f => { const p = path.join(ROOT, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).단지 || {} : {}; };
  for (const [id, v] of Object.entries(rd("data/master/usedate.json"))) if (!v.예정 && /^\d{6}$/.test(v.연월)) USE_YM[id] = { 연월: +v.연월, 출처: "손 확인(" + v.기준 + ")" };
  const ka = rd("data/master/kapt_usedate.json");
  Object.values(MASTER).forEach(x => (x.kapt || []).forEach(k => { const d = ka[k.코드]; if (d && /^\d{6}/.test(d)) USE_YM[x.id] = { 연월: +d.slice(0, 6), 출처: "K-apt 사용승인일 " + d }; }));
}

/* ---------- 1) 지도 ---------- */
function buildMap() {
  const g = JSON.parse(read("data/geo/seoul_gu_2013.geojson"));
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const lat0 = 37.55, kx = Math.cos(lat0 * Math.PI / 180);
  const P = ([lon, lat]) => [lon * kx, -lat];
  g.features.forEach(f => f.geometry.coordinates.flat(f.geometry.type === "MultiPolygon" ? 1 : 0).forEach(ring => ring.forEach(c => {
    const [x, y] = P(c); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  })));
  const W = 1000, s = W / (x1 - x0), H = Math.round((y1 - y0) * s);
  const T = c => { const [x, y] = P(c); return [Math.round((x - x0) * s * 10) / 10, Math.round((y - y0) * s * 10) / 10]; };
  const gu = {};
  g.features.forEach(f => {
    const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    let d = "", sx = 0, sy = 0, n = 0;
    polys.forEach(poly => poly.forEach(ring => {
      const pts = ring.map(T);
      d += "M" + pts.map(p => p.join(",")).join("L") + "Z";
      pts.forEach(p => { sx += p[0]; sy += p[1]; n++; });
    }));
    gu[f.properties.name] = { d, cx: Math.round(sx / n), cy: Math.round(sy / n) };
  });
  // 라벨 위치 손보기 (경계 평균점이 한쪽으로 쏠리는 구)
  const nudge = { "종로구": [0, 18], "강서구": [20, 10], "은평구": [0, 10], "중구": [0, 2], "서초구": [-12, 34], "강남구": [0, -10] };
  for (const [k, [dx, dy]] of Object.entries(nudge)) if (gu[k]) { gu[k].cx += dx; gu[k].cy += dy; }
  return { 설명: "서울 25개 구 경계 SVG (통계청 2013 경계, southkorea/seoul-maps 간략판)", 출처: ["통계청 행정구역 경계 2013(github.com/southkorea/seoul-maps, data/geo/seoul_gu_2013.geojson)"], 기준일: { 자료: "2013" }, 만든곳: "scripts/build_beta.js", viewBox: `0 0 ${W} ${H}`, 구: gu };
}

/* ---------- 2·3) 구별·단지별 ---------- */
function rolling(rows, area) {   // 3개월 이동 중간값
  const by = months.map(() => []);
  rows.forEach(r => { if (r[1] >= area[0] && r[1] < area[1] && idxOf[r[2]] != null) by[idxOf[r[2]]].push(r[4]); });
  return months.map((m, i) => {
    const pool = [].concat(by[i], by[i - 1] || [], by[i - 2] || []);
    return pool.length >= 5 ? median(pool) : null;
  });
}
const LAST_OK = months.length - 2;   // 확정월 = 마지막 달 바로 앞
function peakTrough(series) {   // 월별 값 [..] → 전고점(21~22) · 이후 최저
  let pi = -1;
  months.forEach((m, i) => { if (m >= PEAK_FROM && m <= PEAK_TO && series[i] != null && (pi < 0 || series[i] > series[pi])) pi = i; });
  if (pi < 0) return null;
  let ti = -1;
  for (let i = pi + 1; i < months.length; i++) if (series[i] != null && (ti < 0 || series[i] < series[ti])) ti = i;
  let ci = LAST_OK; while (ci >= 0 && series[ci] == null) ci--;
  const peak = series[pi], low = ti >= 0 ? series[ti] : null, cur = ci >= 0 ? series[ci] : null;
  return {
    전고점: peak, 전고점월: months[pi], 전저점: low, 전저점월: ti >= 0 ? months[ti] : null, 현재: cur, 현재월: ci >= 0 ? months[ci] : null,
    고점대비: cur && peak ? Math.round((cur / peak - 1) * 1000) / 10 : null,
    회복률: cur && peak && low != null && peak > low ? Math.round((cur - low) / (peak - low) * 1000) / 10 : null,
  };
}
function cleanJeonse(rs) { const c = {}; rs.forEach(r => c[r[4]] = (c[r[4]] || 0) + 1); const k = rs.filter(r => c[r[4]] < 3); return k.length ? k : rs; }
function cxArea(sale, jeon, lo, hi, built, win, useYm) {
  const rs = sale.filter(r => r[1] >= lo && r[1] < hi).sort((a, b) => key(a) - key(b));
  if (!rs.length) return null;
  const out = {};
  // 시세: 4층 이상 최근 12개월 최근 3건 중간값
  const r12 = rs.filter(r => r[2] >= from12);
  const up = r12.filter(r => r[5] >= 4);
  const use = (up.length ? up : r12).slice(-3);
  if (use.length) {
    const last = use[use.length - 1];
    out.시세 = median(use.map(r => r[4]));
    out.시세근거 = { 건수: use.length, 층조건: up.length ? "4층 이상" : "전체 층", 최근: last[2] * 100 + last[3], 거래: use.map(r => [r[2] * 100 + r[3], r[4], r[5], typeof r[6] === "string" ? r[6] : "매매"]) };
    out.확정전 = last[2] === lastYm;   // 이번 달 신고분: 해제될 수 있음
  }
  out.건수12 = r12.length;
  // 전고점 · 전저점 (일반 매매만)
  const gen = rs.filter(r => typeof r[6] !== "string");
  const pk = gen.filter(r => r[2] >= PEAK_FROM && r[2] <= PEAK_TO);
  const nIp = rs.filter(r => r[6] === "입주권").length;
  let why = null;
  if (pk.length < 2) {
    if (nIp / rs.length >= 0.5) {
      // 입주권 위주: 이미 준공(사용승인 연월 ≤ 자료 기준월, 연월을 모르면 준공 연도 < 기준월 연도, 또는 일반 매매 있음)이면 '신축(입주권 시절)', 아직이면 '정비사업 진행'
      const done = (useYm ? useYm <= lastYm : !!(built && +built < Math.floor(lastYm / 100))) || gen.length > 0;
      why = done ? "신축입주권" : "입주권";
    }
    else if (rs.some(r => r[6] === "분양권" && r[2] <= PEAK_TO) || (built && +built >= 2021)) why = "신축";
    else why = "거래부족";
  } else {
    const p = pk.reduce((a, b) => (b[4] > a[4] ? b : a));
    let after = gen.filter(r => key(r) > key(p));
    if (after.length >= 2) { const mn = after.reduce((a, b) => (b[4] < a[4] ? b : a)); after = after.filter(r => r !== mn); }
    if (!after.length) why = "거래부족";
    else {
      const t = after.reduce((a, b) => (b[4] < a[4] ? b : a));
      if (t[4] >= p[4]) why = "저≥고";
      else { out.전고점 = [p[4], p[2] * 100 + p[3], p[5]]; out.전저점 = [t[4], t[2] * 100 + t[3], t[5]]; }
    }
  }
  out.사이클 = why ? { 판정: "불가", 이유: why } : { 판정: "가능" };
  // 하락기(서울 84㎡ 시세의 전고점 달 ~ 전저점 달, 데이터로 정함) 일반 매매 건수 — 모든 단지를 같은 구간으로 비교
  if (win && win[0] && win[1]) out.하락기 = { 구간: win, 거래: gen.filter(r => r[2] >= win[0] && r[2] <= win[1]).length };
  if (!why && out.시세) {
    out.낙폭 = Math.round((out.전저점[0] / out.전고점[0] - 1) * 1000) / 10;      // 전고점 → 전저점 (%)
    out.상승률 = Math.round((out.시세 / out.전저점[0] - 1) * 1000) / 10;          // 전저점 → 지금 (%)
  }
  // 전세
  const js = jeon.filter(r => r[1] >= lo && r[1] < hi && !r[6]);
  const jup = js.filter(r => r[5] >= 4).length >= 3 ? js.filter(r => r[5] >= 4) : js;
  let ju = jup.filter(r => r[2] >= from6), span = 6;
  if (ju.length < 3) { ju = jup.filter(r => r[2] >= from12); span = 12; }
  ju = cleanJeonse(ju);
  if (ju.length) out.전세 = [median(ju.map(r => r[4])), ju.length, span];
  // 월별 중간값 (그래프)
  const bm = {}; rs.forEach(r => (bm[r[2]] = bm[r[2]] || []).push(r[4]));
  out.월별 = Object.keys(bm).sort().map(m => [+m, median(bm[m])]);
  return out;
}

// 서울 하락기: 25개 구 84㎡ 시세(3개월 이동 중간값)의 중간값으로 만든 서울 시세의 2021~22 전고점 달 ~ 그 뒤 전저점 달
function seoulWindow() {
  const per = [];
  for (const [gu, code] of Object.entries(INDEX.regions["서울특별시"])) {
    if (!fs.existsSync(path.join(ROOT, `docs/data/${code}.js`))) continue;
    const w = {}; runInto(w, `docs/data/${code}.js`); per.push(rolling(w.DATA_GU[gu].sale, AREAS["84"]));
  }
  const se = months.map((_, i) => { const v = per.map(s => s[i]).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; });
  const pt = peakTrough(se);
  return pt ? [pt.전고점월, pt.전저점월] : null;
}
const SEOUL_WIN = seoulWindow();
function buildData() {
  const GU = {}, CX = {}, ZONES = [];
  for (const [gu, code] of Object.entries(INDEX.regions["서울특별시"])) {
    if (!fs.existsSync(path.join(ROOT, `docs/data/${code}.js`))) continue;
    const w = {}; runInto(w, `docs/data/${code}.js`);
    const D = w.DATA_GU[gu];
    const PRE = (D.presale || []).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6] ? "입주권" : "분양권"]);
    // 구 전체 84㎡ 월별
    const s = rolling(D.sale, AREAS["84"]), j = rolling(D.jeonse.filter(r => !r[6]), AREAS["84"]);
    const pt = peakTrough(s) || {};
    let ci = LAST_OK; while (ci >= 0 && (s[ci] == null || j[ci] == null)) ci--;
    const n6 = D.sale.filter(r => r[1] >= 80 && r[1] < 90 && r[2] >= from6).length;
    GU[gu] = { 코드: code, 매매: s, 전세: j, ...pt, 전세가율: ci >= 0 ? Math.round(j[ci] / s[ci] * 1000) / 10 : null, 거래6개월: n6 };

    // 생활권 대표 단지 (시세 요약 파일에서 단지 목록·세대수·준공을 그대로 씀)
    const SUM = JSON.parse(fs.readFileSync(path.join(SUMMARY, `${code}.json`), "utf8"));
    const CXS = D.complexes.map((c, i) => ({ i, name: c[0], dong: c[3] }));
    const byIdx = new Map(), jbIdx = new Map();
    D.sale.concat(PRE).forEach(r => { if (!byIdx.has(r[0])) byIdx.set(r[0], []); byIdx.get(r[0]).push(r); });
    D.jeonse.forEach(r => { if (!jbIdx.has(r[0])) jbIdx.set(r[0], []); jbIdx.get(r[0]).push(r); });
    const zones = (LZ["서울특별시"] || {})[gu] || [];
    CX[gu] = {};
    zones.forEach(z => {
      const sz = (SUM.생활권 || []).find(x => x.이름 === z.name);
      const list = [];
      // 생활권 대표 단지 목록 자체는 단지 마스터(build_master.js, 가격순 자동 선정)를 따름 — lifezones.js의 complexes는 이제 동 범위(마스터가 씀)만 정함
      (MASTER_BY_ZONE[gu + "|" + z.name] || []).forEach(mx => {
        const cxs = (mx.실거래 || []).map(r => CXS.find(x => x.name === r.이름 && x.dong === r.동)).filter(Boolean);
        if (!cxs.length) return;
        const base = mx.이름;
        const info = sz && sz.단지.find(c => c.이름 === base) || {};
        const sale = [], jeon = [];
        cxs.forEach(x => { (byIdx.get(x.i) || []).forEach(r => sale.push(r)); (jbIdx.get(x.i) || []).forEach(r => jeon.push(r)); });
        const item = { id: mx.id || null, 이름: base, 검색명: cxs[0].name, 준공: info.준공 || mx.준공 || null, 세대수: info.세대수 || mx.세대수 || null, 법정동: info.법정동 || cxs[0].dong };
        const uy = mx.id && USE_YM[mx.id]; if (uy) item.준공월 = uy;
        const win = SEOUL_WIN;
        for (const [a, [lo, hi]] of Object.entries(AREAS)) { const v = cxArea(sale, jeon, lo, hi, item.준공 || mx.준공 || D.complexes[cxs[0].i][4], win, uy && uy.연월); if (v) item[a] = v; }
        list.push(item);
      });
      list.sort((a, b) => (b.세대수 || 0) - (a.세대수 || 0));
      CX[gu][z.name] = list;
      let top = 0; const mids = [];
      list.forEach(c => {
        const a = c["84"]; if (!a) return;
        const t = (a.월별 || []).filter(([m]) => Math.floor(m) >= from12).reduce((mx, [, v]) => Math.max(mx, v), 0);
        top = Math.max(top, t); if (a.시세) mids.push(a.시세);
      });
      ZONES.push({ id: z.id || null, 구: gu, 이름: z.name, 설명: z.note || "", 대장: top || null, 중간: median(mids) });
    });
  }
  const rankBy = k => ZONES.filter(z => z[k]).sort((a, b) => b[k] - a[k]).forEach((z, i) => z[k + "순위"] = i + 1);
  rankBy("대장"); rankBy("중간");
  return { GU, CX, ZONES };
}

fs.mkdirSync(OUT, { recursive: true });
const meta = { 기준월: lastYm, 확정월: months[LAST_OK], 잠정월: lastYm, 자료갱신: INDEX.updated, 월: months,
  출처: ["국토부 아파트 매매·전월세·분양권 실거래가(docs/data, 해제·직거래 제외, 전세는 신규 계약)", "생활권 설정 docs/lifezones.js(훨훨 강의자료)", "단지 마스터 docs/beta/data/master/complexes.json(세대수·ID)"],
  기준일: { 자료: lastYm, 확정: months[LAST_OK], 잠정: lastYm, 갱신: INDEX.updated }, 만든곳: "scripts/build_beta.js" };
fs.writeFileSync(path.join(OUT, "map.json"), JSON.stringify(buildMap()));
const { GU, CX, ZONES } = buildData();
fs.writeFileSync(path.join(OUT, "gu.json"), JSON.stringify({ ...meta, 설명: "구별 84㎡ 3개월 이동 중간값(만원). 매매=해제·직거래 제외, 전세=신규 계약. 전고점=2021~22년 최고, 전저점=그 뒤 최저.", 구: GU }));
// 생활권 화면용 작은 파일: 생활권마다 사이클 성적(하락기 거래·낙폭·상승률·회복률)과 '하락기에도 잘 팔린 단지' 상위 3
const CY = {};
ZONES.forEach(z => {
  const list = CX[z.구][z.이름] || [], g = GU[z.구];
  const one = {};
  ["84", "59"].forEach(A => {
    const L = list.filter(c => c[A] && c[A].사이클 && c[A].사이클.판정 === "가능" && c[A].하락기).map(c => {
      const a = c[A], rec = (a.시세 - a.전저점[0]) / (a.전고점[0] - a.전저점[0]) * 100;
      return { id: c.id, 이름: c.이름, 세대수: c.세대수, 거래: a.하락기.거래, 회전율: c.세대수 ? Math.round(a.하락기.거래 / c.세대수 * 1000) / 10 : null, 낙폭: a.낙폭, 상승률: a.상승률, 회복률: Math.round(rec), 고: a.전고점[0], 저: a.전저점[0], 지금: a.시세 };
    });
    if (!L.length) return;
    const rankOf = (key, desc) => { const s = L.slice().sort((x, y) => desc ? y[key] - x[key] : x[key] - y[key]); L.forEach(x => x[key + "순위"] = s.findIndex(y => y[key] === x[key]) + 1); };
    rankOf("거래", true); rankOf("낙폭", true); rankOf("상승률", true);   // 낙폭은 음수라 큰 값(덜 빠짐)이 1위
    const avg = k => Math.round(L.reduce((t, x) => t + x[k], 0) / L.length * 10) / 10;
    const best = L.length >= 2 ? L.slice().sort((x, y) => (x.거래순위 + x.낙폭순위) - (y.거래순위 + y.낙폭순위) || y.거래 - x.거래).slice(0, 3).map(x => x.id) : [];
    one[A] = { 단지: L, 평균: { 거래: avg("거래"), 낙폭: avg("낙폭"), 상승률: avg("상승률"), 회복률: avg("회복률") }, 잘팔린: best };
  });
  if (Object.keys(one).length) CY[z.id || z.구 + "|" + z.이름] = { 구: z.구, 이름: z.이름, ...one };
});
fs.writeFileSync(path.join(OUT, "cycle.json"), JSON.stringify({ ...meta, 월: undefined, 하락기: SEOUL_WIN, 설명: "생활권별 사이클 성적. 하락기 = 서울 84㎡ 시세(25개 구 3개월 이동 중간값의 중간값)의 2021~22 전고점 달 ~ 그 뒤 전저점 달. 거래 = 그 구간 일반 매매 건수. 낙폭 = 단지 전고점→전저점(%), 상승률 = 전저점→지금 시세(%), 회복률 = (지금-저)/(고-저). 잘팔린 = 거래 순위 + 낙폭 순위 합이 작은 상위 3(단지 2곳 이상일 때).", 생활권: CY }));
fs.writeFileSync(path.join(OUT, "cx.json"), JSON.stringify({ ...meta, 월: undefined, 설명: "생활권 대표 단지 59·84㎡ 지표 (scripts/build_beta.js 머리말 참고). 가격 만원, 날짜 YYYYMMDD.", 생활권: ZONES, 단지: CX }));
console.log(`→ ${path.relative(ROOT, OUT)} (기준월 ${lastYm}) 생활권 ${ZONES.length}곳`);
