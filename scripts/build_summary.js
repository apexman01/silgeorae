#!/usr/bin/env node
/*
 * 구별 시세 요약 파일 만들기 (임장기록용, 작은 JSON)
 *
 *   node scripts/build_summary.js            → docs/beta/data/summary/ (시험판)
 *   node scripts/build_summary.js --out docs/data/summary --no-patch   (정식 반영 시)
 *
 * 사이트와 같은 계산을 쓴다 (docs/beta/index.html 기준).
 *  - 단지 매칭: lifezones.js의 단지명 ('|' 합침, '@동' 지정, 띄어쓰기 무시)
 *  - 면적: 59㎡(55~66), 84㎡(80~90) / 매매 + 분양권·입주권 포함 / 해제·직거래 제외(자료 단계에서 이미 제외)
 *  - 최근 거래 = 계약일이 가장 늦은 거래, 12개월 최고 = 자료 마지막 달 포함 12개월 중 최고가
 *  - 세대수: lifezones hh → 다른 생활권 hh → K-apt(hh.js) 순
 * 기존 docs/data/ 자료 형식은 건드리지 않고, 새 파일만 만든다.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(ROOT, argVal("--out") || "docs/beta/data/summary");
const USE_PATCH = !args.includes("--no-patch");   // 시험판은 lifezones_patch.js까지 적용

const AREAS = { "84": [80, 90], "59": [55, 66] };
const norm = s => String(s).replace(/\s+/g, "").toLowerCase();
const dkey = d => String(d || "").replace(/\d+가$/, "");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

function runInto(win, file) {
  const ctx = { window: win, console };
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx);
}

const win = {};
runInto(win, "docs/data/index.js");
runInto(win, "docs/lifezones.js");
if (USE_PATCH && fs.existsSync(path.join(ROOT, "docs/beta/lifezones_patch.js"))) runInto(win, "docs/beta/lifezones_patch.js");
runInto(win, "docs/data/hh.js");
const INDEX = win.DATA_INDEX, LZ = win.LIFEZONES, HH = win.HH || {};
// 단지 마스터(scripts/build_master.js)가 있으면 세대수 빈칸을 채우는 데 씀 (시험판만, 항목 이름은 그대로)
const MASTER = {};
const MASTER_FILE = path.join(ROOT, "docs/beta/data/master/complexes.json");
if (USE_PATCH && fs.existsSync(MASTER_FILE)) JSON.parse(fs.readFileSync(MASTER_FILE, "utf8")).단지.forEach(x => MASTER[x.구 + "|" + x.생활권이름 + "|" + x.이름] = x);
const months = INDEX.months, lastYm = months[months.length - 1];
const from12 = months[Math.max(0, months.length - 12)];

/* ---- K-apt 세대수 매칭 (docs/beta/index.html의 kclean·kaptFind와 같은 규칙) ---- */
function kclean(s, gu, dong) {
  let t = String(s || "").toLowerCase().replace(/[\s()·.,'’\-_&\[\]]/g, "")
    .replace(/에스케이/g, "sk").replace(/ipark/g, "아이파크").replace(/이편한세상|e-편한세상/g, "e편한세상").replace(/엘지/g, "lg")
    .replace(/아파트|apt|임대|분양|신시가지|서울|총세대기준/g, "").replace(/제(\d)/g, "$1").replace(/(\d+)(단지|차)/g, "$1");
  const stems = [String(dong || "").replace(/\d+가$/, "").replace(/동$/, ""), String(gu || "").replace(/구$/, "")].filter(x => x.length >= 2);
  for (const st of stems) if (t.startsWith(st) && t.length - st.length >= 2) t = t.slice(st.length);
  return t;
}
const KAPT_MEMO = {};
function kaptFind(gu, name, dong) {
  const key = gu + "|" + name + "|" + dong;
  if (key in KAPT_MEMO) return KAPT_MEMO[key];
  const L = HH[gu] || [];
  const d = dkey(dong), n = kclean(name, gu, dong);
  const same = L.filter(r => dkey(r[1]) === d);
  const rent = r => /임대/.test(r[0]) ? 1 : 0;
  const pickBest = c => c.sort((a, b) => rent(a) - rent(b) || Math.abs(kclean(a[0], gu, a[1]).length - n.length) - Math.abs(kclean(b[0], gu, b[1]).length - n.length))[0];
  let c = same.filter(r => kclean(r[0], gu, r[1]) === n);
  if (!c.length) { const all = L.filter(r => kclean(r[0], gu, r[1]) === n); if (all.length === 1) c = all; }
  if (!c.length && n.length >= 3) {
    const dg = t => (t.match(/\d+/g) || []).join(",");
    c = (same.length ? same : L).filter(r => {
      const k = kclean(r[0], gu, r[1]);
      return k.length >= 3 && (k.includes(n) || n.includes(k)) && dg(k) === dg(n) && Math.min(k.length, n.length) / Math.max(k.length, n.length) >= 0.6;
    });
  }
  if (!c.length && /\d$/.test(n)) {
    const nb = n.replace(/\d+$/, "");
    c = same.filter(r => { const k = kclean(r[0], gu, r[1]); return !/\d/.test(k) && k === nb && nb.length >= 2; });
  }
  return (KAPT_MEMO[key] = c.length ? pickBest(c) : null);
}

/* ---- 표기 ---- */
const eokText = man => (man / 10000).toFixed(2).replace(/\.?0+$/, "") + "억";
const ymText = ym => `${String(ym).slice(2, 4)}.${String(ym).slice(4)}`;   // 26.09 (월 두 자리)
function tradeOut(r) {
  if (!r) return null;
  const kind = typeof r[6] === "string" ? r[6] : "매매";
  return { 가격: r[4], 표기: eokText(r[4]), 연월: r[2], 연월표기: ymText(r[2]), 일: r[3], 층: r[5], 전용: r[1], 구분: kind };
}

function buildGu(gu, code) {
  const file = path.join(ROOT, `docs/data/${code}.js`);
  if (!fs.existsSync(file)) return null;
  const w = {};
  runInto(w, `docs/data/${code}.js`);
  const D = w.DATA_GU[gu];
  const CX = D.complexes.map((c, i) => ({ i, name: c[0], dong: c[3], built: c[4] }));
  const PRE = (D.presale || []).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6] ? "입주권" : "분양권"]);
  const ALL = D.sale.concat(PRE);
  const byIdx = new Map();                       // 단지 인덱스 → 거래 (면적대별로 미리 나눔)
  ALL.forEach(r => { if (!byIdx.has(r[0])) byIdx.set(r[0], []); byIdx.get(r[0]).push(r); });

  const zones = (LZ["서울특별시"] || {})[gu] || [];
  const hhAny = nm => { // 다른 생활권 설정에 적힌 세대수 (hhOf와 같은 순서)
    for (const zz of zones) for (const [k, n] of Object.entries(zz.hh || {})) if (k.split("|").some(p => norm(p.split("@")[0]) === nm)) return n;
    return null;
  };
  const outZones = zones.map(z => {
    const list = z.complexes.map((n, order) => {
      const parts = n.split("|").map(p => { const [nm, dong] = p.split("@"); return { nm: norm(nm), dong }; });
      const cxs = CX.filter(x => parts.some(p => p.nm === norm(x.name) && (!p.dong || x.dong.startsWith(p.dong))));
      const base = (z.short && z.short[n]) || n.split("|")[0].split("@")[0];
      const item = { 이름: base, 원래이름: n === base ? undefined : n };
      if (!cxs.length) return { order, item: { ...item, 비고: "실거래 자료에서 단지를 찾지 못함" }, hh: null };
      const built = cxs.map(x => x.built).filter(Boolean).sort()[0] || null;
      const dongs = [...new Set(cxs.map(x => x.dong))];
      let hh = z.hh && z.hh[n];
      if (!hh) hh = hhAny(norm(cxs[0].name));
      if (!hh) { const seen = new Set(); let sum = 0; cxs.forEach(c => { const k = kaptFind(gu, c.name, c.dong); if (k && !seen.has(k)) { seen.add(k); sum += k[2]; } }); hh = sum || null; }
      if (!hh && MASTER[gu + "|" + z.name + "|" + base]) hh = MASTER[gu + "|" + z.name + "|" + base].세대수 || null;   // 단지 마스터(K-apt 이름 맞춤)로 채움
      const idxs = new Set(cxs.map(x => x.i));
      const rows = []; idxs.forEach(i => (byIdx.get(i) || []).forEach(r => rows.push(r)));
      item.준공 = built; item.세대수 = hh ? Number(hh) : null; item.법정동 = dongs.join("·");
      for (const [key, [lo, hi]] of Object.entries(AREAS)) {
        const rs = rows.filter(r => r[1] >= lo && r[1] < hi);
        if (!rs.length) { item[key + "㎡"] = null; continue; }
        const latest = rs.reduce((a, b) => (b[2] * 100 + b[3] > a[2] * 100 + a[3] ? b : a));
        const r12 = rs.filter(r => r[2] >= from12);
        const best12 = r12.length ? r12.reduce((a, b) => (b[4] > a[4] ? b : a)) : null;
        const bestAll = rs.reduce((a, b) => (b[4] > a[4] ? b : a));
        item[key + "㎡"] = { 최근: tradeOut(latest), "12개월최고": tradeOut(best12), 전체기간최고: tradeOut(bestAll), "12개월거래건수": r12.length };
      }
      // 대표평형: 59·84㎡ 거래가 없거나 다른 평형이 주력인 단지용 (매매·분양권 포함 거래가 가장 많은 전용면적, 정수)
      const cnt = {}; rows.forEach(r => { const a = Math.floor(r[1]); cnt[a] = (cnt[a] || 0) + 1; });
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - 84) - Math.abs(b[0] - 84))[0];
      if (top) {
        const rs = rows.filter(r => Math.floor(r[1]) === +top[0]);
        const latest = rs.reduce((a, b) => (b[2] * 100 + b[3] > a[2] * 100 + a[3] ? b : a));
        const r12 = rs.filter(r => r[2] >= from12);
        item.대표평형 = { 전용: +top[0], 거래건수: rs.length, 최근: tradeOut(latest), "12개월최고": r12.length ? tradeOut(r12.reduce((a, b) => (b[4] > a[4] ? b : a))) : null };
      }
      return { order, item, hh: item.세대수 };
    });
    // 세대수 많은 순 (세대수 없는 단지는 뒤로, 원래 순서 유지)
    list.sort((a, b) => (b.hh || 0) - (a.hh || 0) || a.order - b.order);
    return {
      이름: z.name, 설명: z.note || undefined,
      단지: list.map((x, k) => ({ 번호: k + 1, ...x.item })),
    };
  });
  return { 구: gu, 구코드: code, 생활권: outZones };
}

fs.mkdirSync(OUT, { recursive: true });
const made = [];
for (const [gu, code] of Object.entries(INDEX.regions["서울특별시"])) {
  const g = buildGu(gu, code);
  if (!g) continue;
  const doc = {
    설명: "생활권별 대표 단지 시세 요약. 가격 단위는 만원, 표기는 억. 구분=매매/분양권/입주권(분양권·입주권은 거래에 포함하되 구분 표시). 12개월 = 기준월 포함 최근 12개월.",
    기준월: lastYm, 기준월표기: ymText(lastYm), "12개월시작": from12, 자료갱신: INDEX.updated,
    출처: ["국토부 아파트 매매·분양권 실거래가(docs/data, 해제·직거래 제외)", "공동주택관리정보시스템 K-apt 세대수(docs/data/hh.js)", "생활권 설정 docs/lifezones.js(훨훨 강의자료)"], 기준일: { 자료: lastYm, 갱신: INDEX.updated }, 만든곳: "scripts/build_summary.js",
    ...g,
  };
  fs.writeFileSync(path.join(OUT, `${code}.json`), JSON.stringify(doc));
  made.push({ 구: gu, 구코드: code, 파일: `${code}.json`, 생활권수: g.생활권.length });
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ 기준월: lastYm, 자료갱신: INDEX.updated, 출처: ["국토부 아파트 매매·분양권 실거래가(docs/data, 해제·직거래 제외)", "공동주택관리정보시스템 K-apt 세대수(docs/data/hh.js)", "생활권 설정 docs/lifezones.js(훨훨 강의자료)"], 기준일: { 자료: lastYm, 갱신: INDEX.updated }, 만든곳: "scripts/build_summary.js", 구: made }));
console.log(`${made.length}개 구 → ${path.relative(ROOT, OUT)} (기준월 ${lastYm}, 12개월 시작 ${from12})`);
