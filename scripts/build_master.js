#!/usr/bin/env node
/*
 * 단지 마스터 (시험판) — 생활권 설정·실거래·세대수(K-apt)·정비사업을 하나의 단지 ID로 묶는다
 *
 *   node scripts/build_master.js            → docs/beta/data/master/complexes.json, jb_zones.json
 *
 * 단지 ID: K-apt 단지코드(예: A13528004, 여러 동이 합쳐진 단지는 세대수가 가장 큰 코드)
 *          K-apt에서 못 찾으면 규칙 ID "R-{구코드}-{정리한 단지명}" (이름이 그대로면 매달 같은 ID)
 *
 * 생활권 대표 단지 선정(2026-11-27부터): "가격이 가장 높은 N곳"으로 자동 선정 (N = lifezones.js에 지금 적힌 단지 수, 보통 5).
 *   - 생활권의 "동네 범위"(법정동)는 그대로 lifezones.js 손 목록에서 구함(그 목록에 적힌 단지들이 있는 동 전체) — 경계는 안 바꿈.
 *   - 그 범위 안의 모든 단지(K-apt 단지 + K-apt에 없는 입주권·신축 단지)를 후보로 놓고, 지금 시세(84㎡ 우선, 없으면 59㎡ — 분양권·입주권 포함)가 높은 순으로 N곳을 고름.
 *   - lifezones.js의 complexes 목록은 더 이상 "이 단지를 넣어라"가 아니라 "이 동네 범위"를 정하는 용도로만 씀. hh(세대수 강의자료 값)·short(별명)는 이제 안 씀(세대수는 K-apt에서 바로 읽음).
 *   - 가격 자료가 없는(최근 12개월 거래 없음) 후보는 순위에서 빠짐.
 *   - 강의자료 목록과 달라진 곳은 report.json의 생활권_단지_교체에 적힘(확인용).
 * 연결 방법
 *  - 실거래 ↔ K-apt: 같은 법정동 안에서 이름 비교(완전 일치 > 포함 > 글자 유사도). 숫자(차·단지)가 다르면 연결 안 함
 *  - 손으로 고칠 곳: data/master/overrides.json ("구|단지명": {"kapt": ["A…"], "세대수": n}) — 이름이 선정된 단지와 같을 때만 적용
 *  - 정비사업: 같은 구·동의 정비구역 이름(괄호 안 단지명 포함)과 단지명이 겹치면 연결
 *  - 정비구역 → 생활권: 사이트(jbAssign)와 같은 규칙 (lifezones의 jb → jbDongs → 대표 단지가 있는 동이 한 생활권뿐일 때)
 * 세대수: K-apt 값(선정된 단지가 K-apt에 없으면 overrides.json 값, 그래도 없으면 빈 칸)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs/beta/data/master");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
function runInto(win, file) { const ctx = { window: win, console }; vm.createContext(ctx); vm.runInContext(read(file), ctx); }
const norm = s => String(s).replace(/\s+/g, "").toLowerCase();
const dkey = d => String(d || "").replace(/\d+가$/, "");
const digits = s => (String(s).match(/\d+/g) || []).map(Number);

const win = {};
runInto(win, "docs/data/index.js");
runInto(win, "docs/lifezones.js");
if (fs.existsSync(path.join(ROOT, "docs/beta/lifezones_patch.js"))) runInto(win, "docs/beta/lifezones_patch.js");
runInto(win, fs.existsSync(path.join(ROOT, "docs/beta/data/jb.js")) ? "docs/beta/data/jb.js" : "docs/data/jb.js");
const INDEX = win.DATA_INDEX, LZ = win.LIFEZONES, JB = win.JB;
const KLIST = JSON.parse(read("data/cache/hh_list.json"));      // 구 → [{code, name, dong, bjd}]
const KBASIC = JSON.parse(read("data/cache/hh_basic.json"));    // code → {cnt, use, name}
const OVR = fs.existsSync(path.join(ROOT, "data/master/overrides.json")) ? Object.fromEntries(Object.entries(JSON.parse(read("data/master/overrides.json"))).filter(([k]) => !k.startsWith("_"))) : {};

/* 이름 정리 (build_summary.js·사이트 kclean과 같은 규칙) */
function kclean(s, gu, dong) {
  let t = String(s || "").toLowerCase().replace(/[\s()·.,'’\-_&\[\]]/g, "")
    .replace(/에스케이/g, "sk").replace(/ipark/g, "아이파크").replace(/이편한세상|e-편한세상/g, "e편한세상").replace(/엘지/g, "lg")
    .replace(/아파트|apt|임대|분양|신시가지|서울|총세대기준/g, "").replace(/제(\d)/g, "$1").replace(/(\d+)(단지|차)/g, "$1");
  const stems = [String(dong || "").replace(/\d+가$/, "").replace(/동$/, ""), String(gu || "").replace(/구$/, "")].filter(x => x.length >= 2);
  for (const st of stems) if (t.startsWith(st) && t.length - st.length >= 2) t = t.slice(st.length);
  return t;
}
function bigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; }
function dice(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return 0; let m = 0; const bb = B.slice(); A.forEach(x => { const i = bb.indexOf(x); if (i >= 0) { m++; bb.splice(i, 1); } }); return 2 * m / (A.length + B.length); }
// 이름 둘이 같은 단지인지 점수(0~100). t·k 둘 다 "일반 이름"(실거래명이든 K-apt명이든 상관없이 씀)
function pairScore(t, k, gu, dong) {
  const tt = kclean(t, gu, dong), kc = kclean(k, gu, dong);
  const td = digits(t.replace(/\(.*?\)/g, "")), kd = digits(k.replace(/\(.*?\)/g, ""));
  if (!tt || !kc) return 0;
  if (td.length && kd.length && !td.every(x => kd.includes(x))) return 0;   // 1단지 ↔ 2단지 같은 오연결 막기
  if (tt === kc) return 100;
  if (Math.min(tt.length, kc.length) >= 2 && (kc.includes(tt) || tt.includes(kc))) return 88 - Math.abs(tt.length - kc.length) * 2 - (td.length !== kd.length ? 8 : 0);
  const d = dice(tt, kc); return d >= 0.5 ? 45 + 40 * d - (td.length !== kd.length ? 8 : 0) : 0;
}
function score(tradeNames, gu, dong, k) { return Math.max(0, ...tradeNames.map(t => pairScore(t, k.name, gu, dong))); }
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

const AREAS = { "84": [80, 90], "59": [55, 66] };
const months = INDEX.months, lastYm = months[months.length - 1], from12 = months[Math.max(0, months.length - 12)];
// 지금 시세(84㎡ 우선, 없으면 59㎡): 4층 이상 최근 12개월 최근 3건 중간값, 분양권·입주권 포함 (docs/beta/index.html·build_beta.js와 같은 정의)
function priceOf(rows) {
  for (const [lo, hi] of [AREAS["84"], AREAS["59"]]) {
    const rs = rows.filter(r => r[1] >= lo && r[1] < hi && r[2] >= from12).sort((a, b) => (a[2] * 100 + a[3]) - (b[2] * 100 + b[3]));
    if (!rs.length) continue;
    const up = rs.filter(r => r[5] >= 4);
    const use = (up.length ? up : rs).slice(-3);
    if (use.length) return { 값: median(use.map(r => r[4])), 면적: lo === 80 ? "84" : "59" };
  }
  return null;
}
const out = [], zoneJb = [], failKapt = [], failJbZone = [], swapReport = [];
for (const [gu, code] of Object.entries(INDEX.regions["서울특별시"])) {
  if (!fs.existsSync(path.join(ROOT, `docs/data/${code}.js`))) continue;
  const w = {}; runInto(w, `docs/data/${code}.js`);
  const D = w.DATA_GU[gu];
  const CX = D.complexes.map((c, i) => ({ i, name: c[0], dong: c[3], built: c[4] }));
  const PRE = (D.presale || []).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6] ? "입주권" : "분양권"]);
  const rowsByIdx = new Map(); D.sale.concat(PRE).forEach(r => { if (!rowsByIdx.has(r[0])) rowsByIdx.set(r[0], []); rowsByIdx.get(r[0]).push(r); });
  const cnt = new Map(); D.sale.concat(PRE).forEach(r => { const k = r[0] + "|" + Math.floor(r[1]); cnt.set(k, (cnt.get(k) || 0) + 1); });
  const kl = KLIST[gu] || [];
  const zones = (LZ["서울특별시"] || {})[gu] || [];
  const jbRows = (JB.rows[gu] || []);
  const matchIdx = n => { const parts = n.split("|").map(p => { const [nm, dong] = p.split("@"); return { nm: norm(nm), dong }; }); return CX.filter(x => parts.some(p => p.nm === norm(x.name) && (!p.dong || x.dong.startsWith(p.dong)))); };
  // 정비구역 연결 여부 (아직 K-apt에 없는 입주권·신축 후보가 "진짜 큰 정비사업"인지 미리 걸러낼 때도 씀)
  function jbHitFor(tradeNames, dongs) {
    const al = tradeNames.map(t => kclean(t, gu, dongs[0])).filter(t => t.length >= 3);
    return jbRows.filter(r => dongs.some(d => dkey(d) === dkey(r.dong)) && (() => {
      const names = [r.name].concat((r.name.match(/\((.*?)\)/) || [])[1] || []).map(x => kclean(String(x).replace(/\(.*?\)/g, ""), gu, r.dong)).filter(x => x.length >= 3);
      const jd = digits(r.name), cd = tradeNames.map(t => digits(t.replace(/\(.*?\)/g, "")));
      if (jd.length && cd.some(d => d.length) && !cd.some(d => d.length && d.every(x => jd.includes(x)))) return false;   // 신반포2차 ↔ 신반포22차 같은 오연결 막기
      return names.some(j => al.some(a => a === j || ((a.includes(j) || j.includes(a)) && Math.min(a.length, j.length) >= 3)));
    })());
  }
  const MIN_HH = 80;   // 너무 작은(다세대 등으로 잘못 섞인) 단지가 '최고가'로 뽑히는 것을 막는 바닥값 (지금 강의자료 최소 세대수가 91)
  const globalClaim = new Set();   // 이 구 안에서 이미 다른 생활권이 고른 단지(동이 두 생활권에 걸치면 겹칠 수 있어서 — 먼저 처리된 생활권이 가짐, lifezones.js 순서)
  // 법정동 하나가 큰 경우 생활권 여러 곳이 그 동을 나눠 씀(예: 전농동 안에 청량리·전농답십리 둘 다). 그런 동이 섞이면
  // "동 전체가 이 생활권 것"이라는 전제가 깨져서 가격순 자동 선정을 하면 안 됨 → 그 생활권은 강의자료 목록 그대로 둠(아래 legacyZoneItems).
  const dongSets = zones.map(z => { const s = new Set(); z.complexes.forEach(n => matchIdx(n).forEach(x => s.add(dkey(x.dong)))); return s; });
  const zoneShared = dongSets.map((s, zi) => [...s].some(d => dongSets.some((s2, j) => j !== zi && s2.has(d))));

  function legacyZoneItems(z) {   // 예전 방식: 강의자료 목록 그대로, K-apt는 트레이드명으로 찾기
    return z.complexes.map(n => {
      const base = (z.short && z.short[n]) || n.split("|")[0].split("@")[0];
      const cxs = matchIdx(n);
      const dongs = [...new Set(cxs.map(x => x.dong))];
      const tradeNames = [...new Set(cxs.map(x => x.name).concat(n.split("|").map(p => p.split("@")[0]), [base]))];
      const ov = OVR[gu + "|" + base] || {};
      let kapt = [], kScore = 0;
      if (ov.kapt) kScore = 999, kapt = ov.kapt.map(c => kl.find(k => k.code === c) || { code: c, name: (KBASIC[c] || {}).name || "", dong: "" });
      else {
        const pool = kl.filter(k => dongs.some(d => dkey(d) === dkey(k.dong)));
        const scored = pool.map(k => ({ k, s: score(tradeNames, gu, dongs[0], k) })).filter(x => x.s >= 60).sort((a, b) => b.s - a.s);
        if (scored.length) { kScore = scored[0].s; kapt = scored.filter(x => x.s >= scored[0].s - 0.001).map(x => x.k); }
      }
      kapt = [...new Map(kapt.map(k => [k.code, k])).values()].sort((a, b) => ((KBASIC[b.code] || {}).cnt || 0) - ((KBASIC[a.code] || {}).cnt || 0));
      const kSum = kapt.reduce((s, k) => s + ((KBASIC[k.code] || {}).cnt || 0), 0) || null;
      const lzHh = z.hh && z.hh[n];
      const hh = ov.세대수 || lzHh || kSum || null;
      const hhSrc = ov.세대수 ? "직접 입력(overrides)" : lzHh ? "생활권 설정(강의자료)" : kSum ? "K-apt" : null;
      const built = cxs.map(x => x.built).filter(Boolean).sort()[0] || (kapt[0] && (KBASIC[kapt[0].code] || {}).use) || null;
      const ac = {}; cxs.forEach(x => cnt.forEach((v, k) => { const [i, a] = k.split("|"); if (+i === x.i) ac[a] = (ac[a] || 0) + v; }));
      const rep = Object.entries(ac).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - 84) - Math.abs(b[0] - 84))[0];
      const jbHit = jbHitFor(tradeNames, dongs);
      const id = kapt.length ? kapt[0].code : `R-${code}-${kclean(base, gu, dongs[0]) || norm(base)}`;
      const item = {
        id, 이름: base, 별칭: tradeNames.filter(x => x !== base), 구: gu, 구코드: code, 동: dongs, 생활권: z.id || null, 생활권이름: z.name,
        세대수: hh ? Number(hh) : null, 세대수출처: hhSrc, 준공: built, 대표평형: rep ? +rep[0] : null, 선정가: null, 선정가면적: null,
        kapt: kapt.map(k => ({ 코드: k.code, 이름: k.name, 세대수: (KBASIC[k.code] || {}).cnt || null })),
        실거래: cxs.map(x => ({ 이름: x.name, 동: x.dong })),
        정비사업: jbHit.length ? jbHit.map(r => ({ 코드: r.code, 구역: r.name, 단계: r.stage })) : null,
      };
      item._s = kScore;
      item._fail = () => kapt.length ? null : { 구: gu, 생활권: z.name, 단지: base, 실거래명: cxs.map(x => x.name).join("|"), 동: dongs.join("·"), 세대수: item.세대수, 비고: "강의자료 목록(동이 다른 생활권과 겹쳐 자동 선정 안 함)" };
      item._rid = `R-${code}-${kclean(base, gu, dongs[0]) || norm(base)}`;
      return item;
    });
  }

  zones.forEach((z, zi) => {
    if (zoneShared[zi]) { out.push(...legacyZoneItems(z)); return; }   // 동이 다른 생활권과 겹침 → 강의자료 목록 그대로
    // 1) 생활권의 동네 범위 = 강의자료 목록에 적힌 단지들이 있는 동 전체 (경계는 안 바꿈)
    const 범위동 = dongSets[zi];
    const handNames = new Set(z.complexes.map(n => (z.short && z.short[n]) || n.split("|")[0].split("@")[0]));

    // 2) 그 동 안의 모든 단지를 후보로: K-apt 단지 + (K-apt에 없는) 실거래 단지를 이름 유사도로 묶어서
    const kPool = kl.filter(k => 범위동.has(dkey(k.dong)));
    const cxInZone = CX.filter(x => 범위동.has(dkey(x.dong)));
    const claimed = new Set();
    const cands = [];
    kPool.forEach(k => {
      const matched = cxInZone.filter(x => pairScore(x.name, k.name, gu, x.dong) >= 60);
      matched.forEach(x => claimed.add(x.i));
      if (globalClaim.has("K:" + k.code)) return;   // 동이 겹쳐서 다른 생활권이 이미 가져감
      const 세대수 = (KBASIC[k.code] || {}).cnt || null;
      const inHand = handNames.has(k.name) || matched.some(x => handNames.has(x.name));
      if (!inHand && (!세대수 || 세대수 < MIN_HH)) return;   // 너무 작은 단지는 최고가라도 후보에서 뺌(강의자료에 이미 있던 건 예외)
      const rows = []; matched.forEach(x => (rowsByIdx.get(x.i) || []).forEach(r => rows.push(r)));
      const p = priceOf(rows); if (!p) return;   // 최근 12개월 거래 없으면 순위 후보에서 뺌(선정 못 됨)
      cands.push({ k, matched, rows, p, 세대수, 준공: (KBASIC[k.code] || {}).use || null });
    });
    // K-apt로 못 묶은 나머지 실거래 단지(주로 입주권·신축): 이름 유사도로 자기들끼리 묶어서 후보에 추가
    // (K-apt 세대수로 크기를 확인할 수 없으니, 정비구역으로 이미 등록됐거나 강의자료에 있던 것만 후보로 — 작은 단지가 낀 거래 1건으로 '최고가'가 되는 것 방지)
    const orphans = cxInZone.filter(x => !claimed.has(x.i));
    const used = new Set();
    orphans.forEach(x => {
      if (used.has(x.i)) return;
      const grp = orphans.filter(y => !used.has(y.i) && (y.i === x.i || pairScore(y.name, x.name, gu, x.dong) >= 70));
      grp.forEach(y => used.add(y.i));
      const okey = "O:" + grp.map(y => y.i).sort((a, b) => a - b).join(",");
      if (globalClaim.has(okey)) return;
      const names = [...new Set(grp.map(y => y.name))], dongs = [...new Set(grp.map(y => y.dong))];
      const inHand = names.some(n => handNames.has(n));
      if (!inHand && !jbHitFor(names, dongs).length) return;
      const rows = []; grp.forEach(y => (rowsByIdx.get(y.i) || []).forEach(r => rows.push(r)));
      const p = priceOf(rows); if (!p) return;
      cands.push({ k: null, okey, matched: grp, rows, p, 세대수: null, 준공: grp.map(y => y.built).filter(Boolean).sort()[0] || null });
    });

    // 3) 가격 높은 순으로 N곳(N = 강의자료에 지금 적힌 단지 수) 선정
    cands.sort((a, b) => b.p.값 - a.p.값 || ((b.세대수 || 0) - (a.세대수 || 0)));
    const picked = cands.slice(0, z.complexes.length);
    picked.forEach(c => globalClaim.add(c.k ? "K:" + c.k.code : c.okey));
    const pickedNames = new Set();

    picked.forEach(c => {
      const tradeNames = [...new Set(c.matched.map(x => x.name))];
      const dongs = [...new Set(c.matched.map(x => x.dong).concat(c.k ? [c.k.dong] : []))];
      const base0 = c.k ? c.k.name.replace(/\s*아파트\s*$/, "").replace(/\s+/g, " ").trim() : tradeNames.slice().sort((a, b) => b.length - a.length)[0];
      // 강의자료 이름과 같은 단지면(이름이 겹치면) 그 이름을 그대로 써서 기존 링크·표시가 안 바뀌게 함
      const handSame = [...handNames].find(h => tradeNames.some(t => norm(t) === norm(h)) || norm(h) === norm(base0));
      const base = handSame || base0;
      pickedNames.add(base);
      // K-apt 연결 손 수정(overrides.json) — 선정된 이름과 같을 때만 적용
      const ov = OVR[gu + "|" + base] || {};
      let kapt = c.k ? [c.k] : [];
      if (ov.kapt) kapt = ov.kapt.map(cc => kl.find(k => k.code === cc) || { code: cc, name: (KBASIC[cc] || {}).name || "", dong: "" });
      const kSum = kapt.reduce((s, k) => s + ((KBASIC[k.code] || {}).cnt || 0), 0) || null;
      const hh = ov.세대수 || kSum || null;
      const hhSrc = ov.세대수 ? "직접 입력(overrides)" : kSum ? "K-apt" : null;
      const built = c.matched.map(x => x.built).filter(Boolean).sort()[0] || c.준공 || null;
      const ac = {}; c.matched.forEach(x => cnt.forEach((v, k) => { const [i, a] = k.split("|"); if (+i === x.i) ac[a] = (ac[a] || 0) + v; }));
      const rep = Object.entries(ac).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - 84) - Math.abs(b[0] - 84))[0];
      const jbHit = jbHitFor(tradeNames.concat([base]), dongs);
      const id = kapt.length ? kapt[0].code : `R-${code}-${kclean(base, gu, dongs[0]) || norm(base)}`;
      const item = {
        id, 이름: base, 별칭: tradeNames.filter(x => x !== base), 구: gu, 구코드: code, 동: dongs, 생활권: z.id || null, 생활권이름: z.name,
        세대수: hh ? Number(hh) : null, 세대수출처: hhSrc, 준공: built, 대표평형: rep ? +rep[0] : null,
        선정가: c.p.값, 선정가면적: c.p.면적,
        kapt: kapt.map(k => ({ 코드: k.code, 이름: k.name, 세대수: (KBASIC[k.code] || {}).cnt || null })),
        실거래: c.matched.map(x => ({ 이름: x.name, 동: x.dong })),
        정비사업: jbHit.length ? jbHit.map(r => ({ 코드: r.code, 구역: r.name, 단계: r.stage })) : null,
      };
      item._s = 100;
      item._fail = () => kapt.length ? null : { 구: gu, 생활권: z.name, 단지: base, 실거래명: tradeNames.join("|"), 동: dongs.join("·"), 세대수: item.세대수, 비고: "가격순 선정(입주권·신축 등 K-apt에 아직 없음)" };
      item._rid = `R-${code}-${kclean(base, gu, dongs[0]) || norm(base)}`;
      out.push(item);
    });
    // 강의자료 목록 대비 바뀐 곳 보고 (확인용)
    const added = [...pickedNames].filter(n => !handNames.has(n)), removed = [...handNames].filter(n => !pickedNames.has(n));
    if (added.length || removed.length) swapReport.push({ 구: gu, 생활권: z.name, 강의자료: [...handNames], 가격순선정: [...pickedNames], 빠짐: removed, 새로들어옴: added });
  });
  // 정비구역 → 생활권 (사이트 jbAssign과 같은 규칙)
  const autoDongs = zones.map(z => { const ds = new Set(); z.complexes.forEach(n => matchIdx(n).forEach(x => ds.add(dkey(x.dong)))); return ds; });
  const jbMatch = (z, name) => (z.jb || []).some(k => k.endsWith("-") ? name.startsWith(k) : name === k);
  jbRows.filter(r => r.new > 0 || r.old > 0).forEach(r => {
    let zi = zones.findIndex(z => jbMatch(z, r.name)), how = "lifezones jb";
    const rd = dkey(r.dong);
    if (zi < 0) { zi = zones.findIndex(z => (z.jbDongs || []).map(dkey).includes(rd)); how = "lifezones jbDongs"; }
    if (zi < 0) { const hit = autoDongs.map((ds, i) => ds.has(rd) ? i : -1).filter(i => i >= 0); if (hit.length === 1) { zi = hit[0]; how = "대표 단지 동"; } else how = hit.length ? `동이 생활권 ${hit.length}곳에 걸침` : "대표 단지가 없는 동"; }
    zoneJb.push({ 코드: r.code, 구: gu, 구역: r.name, 동: r.dong, 단계: r.stage, 생활권: zi >= 0 ? zones[zi].id : null, 생활권이름: zi >= 0 ? zones[zi].name : null, 연결: zi >= 0 ? how : null });
    if (zi < 0) failJbZone.push({ 구: gu, 구역: r.name, 동: r.dong, 단계: r.stage, 신규세대: r.new, 이유: how });
  });
}

// 같은 K-apt 코드에 단지가 여럿 붙으면: 이름이 가장 비슷한 쪽만 코드를 가짐.
// 점수가 같으면(예: 압구정현대1·2차·6·7차가 K-apt에 '압구정현대아파트' 하나로 등록) 코드를 함께 쓰고 ID 뒤에 -2, -3을 붙임
const dups = [];
const byCode = {}; out.forEach(x => { if (x.kapt.length) (byCode[x.id] = byCode[x.id] || []).push(x); });
for (const [code, list] of Object.entries(byCode)) {
  if (list.length < 2) continue;
  list.sort((a, b) => b._s - a._s);
  const top = list[0]._s;
  list.forEach((x, k) => {
    if (k === 0) return;
    if (x._s >= top - 0.001) {   // K-apt에 여러 단지(차수)가 한 번에 등록 → 세대수는 합계라 각 단지 값으로 쓰지 않음
      x.id = `${code}-${k + 1}`; x.kapt공유 = list[0].이름;
      [list[0], x].forEach(y => { y.kapt공동등록 = true; if (y.세대수출처 === "K-apt") { y.세대수 = null; y.세대수출처 = "K-apt 공동 등록(합계만 있음)"; } });
      dups.push([code, "공동 등록", list.map(y => y.이름)]);
    }
    else {   // 덜 비슷한 쪽은 연결을 끊음
      x.kapt = []; x.id = x._rid;
      if (x.세대수출처 === "K-apt") { x.세대수 = null; x.세대수출처 = null; }
      dups.push([code, "연결 끊음", x.이름 + " (코드는 " + list[0].이름 + "에)"]);
    }
  });
}
out.forEach(x => { const f = x._fail(); if (f) failKapt.push(f); });
const seen = new Set(); out.forEach(x => { if (seen.has(x.id)) x.id += "-" + x.생활권; seen.add(x.id); });   // 규칙 ID가 우연히 겹칠 때
out.forEach(x => { delete x._s; delete x._fail; delete x._rid; });

const meta = (설명) => ({
  설명, 출처: ["국토부 실거래가(docs/data)", "공동주택관리정보시스템 K-apt 단지 목록·기본정보(data/cache/hh_list.json, hh_basic.json)", "서울 열린데이터광장 OA-22856 정비사업", "생활권 설정 docs/lifezones.js(훨훨 강의자료)"],
  기준일: { 자료: lastYm, 갱신: INDEX.updated, 정비사업: JB.asof || "" }, 만든곳: "scripts/build_master.js",
});
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "complexes.json"), JSON.stringify({ ...meta("생활권 대표 단지 마스터. id = K-apt 단지코드(없으면 R-구코드-이름). 선정가·선정가면적 = 가격순 선정 때 쓴 시세(4층 이상 최근 12개월 최근 3건 중간값, 84㎡ 우선·분양권·입주권 포함). 세대수출처로 어디서 온 값인지 표시."), 단지: out }));
fs.writeFileSync(path.join(OUT, "jb_zones.json"), JSON.stringify({ ...meta("정비구역 → 생활권 연결표 (사이트 정비사업 탭과 같은 규칙). 생활권이 null이면 연결 못 한 구역."), 구역: zoneJb }));
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ...meta("매칭 실패 목록·강의자료 대비 바뀐 곳 (사람이 확인할 것)"), K_apt_못찾음: failKapt, 생활권_못붙인_정비구역: failJbZone, ID_겹침: dups, 생활권_단지_교체: swapReport }, null, 1));

const withK = out.filter(x => x.kapt.length).length, noHh = out.filter(x => !x.세대수).length;
console.log(`단지 ${out.length}곳 · K-apt 연결 ${withK} · 못 찾음 ${failKapt.length} · 세대수 없음 ${noHh} · 정비사업 연결 단지 ${out.filter(x => x.정비사업).length} · ID 겹침 ${dups.length}`);
console.log(`정비구역 ${zoneJb.length}곳 · 생활권 연결 ${zoneJb.length - failJbZone.length} · 못 붙임 ${failJbZone.length}`);
