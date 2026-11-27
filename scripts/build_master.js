#!/usr/bin/env node
/*
 * 단지 마스터 (시험판) — 생활권 설정·실거래·세대수(K-apt)·정비사업을 하나의 단지 ID로 묶는다
 *
 *   node scripts/build_master.js            → docs/beta/data/master/complexes.json, jb_zones.json
 *
 * 단지 ID: K-apt 단지코드(예: A13528004, 여러 동이 합쳐진 단지는 세대수가 가장 큰 코드)
 *          K-apt에서 못 찾으면 규칙 ID "R-{구코드}-{정리한 단지명}" (이름이 그대로면 매달 같은 ID)
 * 연결 방법
 *  - 생활권 → 실거래: lifezones.js 단지명 ('|' 합침, '@동' 지정, 띄어쓰기 무시) — 사이트와 같은 규칙
 *  - 실거래 → K-apt: 같은 법정동 안에서 이름 비교(완전 일치 > 포함 > 글자 유사도). 숫자(차·단지)가 다르면 연결 안 함
 *  - 손으로 고칠 곳: data/master/overrides.json ("구|단지명": {"kapt": ["A…"], "세대수": n})
 *  - 정비사업: 같은 구·동의 정비구역 이름(괄호 안 단지명 포함)과 단지명이 겹치면 연결
 *  - 정비구역 → 생활권: 사이트(jbAssign)와 같은 규칙 (lifezones의 jb → jbDongs → 대표 단지가 있는 동이 한 생활권뿐일 때)
 * 세대수: 생활권 설정(강의자료) 값 → 없으면 K-apt 합계
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
function score(tradeNames, gu, dong, k) {
  const kc = kclean(k.name, gu, k.dong), kd = digits(k.name.replace(/\(.*?\)/g, ""));
  let best = 0;
  for (const nm of tradeNames) {
    const t = kclean(nm, gu, dong), td = digits(nm.replace(/\(.*?\)/g, ""));
    if (!t || !kc) continue;
    if (td.length && kd.length && !td.every(x => kd.includes(x))) continue;   // 1단지 ↔ 2단지 같은 오연결 막기
    let s = 0;
    if (t === kc) s = 100;
    else if (Math.min(t.length, kc.length) >= 2 && (kc.includes(t) || t.includes(kc))) s = 88 - Math.abs(t.length - kc.length) * 2 - (td.length !== kd.length ? 8 : 0);
    else { const d = dice(t, kc); if (d >= 0.5) s = 45 + 40 * d - (td.length !== kd.length ? 8 : 0); }
    best = Math.max(best, s);
  }
  return best;
}

const months = INDEX.months, lastYm = months[months.length - 1];
const out = [], zoneJb = [], failKapt = [], failJbZone = [];
for (const [gu, code] of Object.entries(INDEX.regions["서울특별시"])) {
  if (!fs.existsSync(path.join(ROOT, `docs/data/${code}.js`))) continue;
  const w = {}; runInto(w, `docs/data/${code}.js`);
  const D = w.DATA_GU[gu];
  const CX = D.complexes.map((c, i) => ({ i, name: c[0], dong: c[3], built: c[4] }));
  const cnt = new Map(); D.sale.concat(D.presale || []).forEach(r => { const k = r[0] + "|" + Math.floor(r[1]); cnt.set(k, (cnt.get(k) || 0) + 1); });
  const kl = KLIST[gu] || [];
  const zones = (LZ["서울특별시"] || {})[gu] || [];
  const jbRows = (JB.rows[gu] || []);
  const matchIdx = n => { const parts = n.split("|").map(p => { const [nm, dong] = p.split("@"); return { nm: norm(nm), dong }; }); return CX.filter(x => parts.some(p => p.nm === norm(x.name) && (!p.dong || x.dong.startsWith(p.dong)))); };

  zones.forEach(z => {
    z.complexes.forEach(n => {
      const base = (z.short && z.short[n]) || n.split("|")[0].split("@")[0];
      const cxs = matchIdx(n);
      const dongs = [...new Set(cxs.map(x => x.dong))];
      const tradeNames = [...new Set(cxs.map(x => x.name).concat(n.split("|").map(p => p.split("@")[0]), [base]))];
      // K-apt 연결
      const ov = OVR[gu + "|" + base] || {};
      let kapt = [], kScore = 0;
      if (ov.kapt) kScore = 999, kapt = ov.kapt.map(c => kl.find(k => k.code === c) || { code: c, name: (KBASIC[c] || {}).name || "", dong: "" });
      else {
        const pool = kl.filter(k => dongs.some(d => dkey(d) === dkey(k.dong)));
        const scored = pool.map(k => ({ k, s: score(tradeNames, gu, dongs[0], k) })).filter(x => x.s >= 60).sort((a, b) => b.s - a.s);
        // 같은 점수 최고점 묶음만 (여러 동으로 나뉜 단지: 이름이 완전히 같은 K-apt가 여럿이면 함께)
        if (scored.length) { kScore = scored[0].s; kapt = scored.filter(x => x.s >= scored[0].s - 0.001).map(x => x.k); }
      }
      kapt = [...new Map(kapt.map(k => [k.code, k])).values()].sort((a, b) => ((KBASIC[b.code] || {}).cnt || 0) - ((KBASIC[a.code] || {}).cnt || 0));
      const kSum = kapt.reduce((s, k) => s + ((KBASIC[k.code] || {}).cnt || 0), 0) || null;
      const lzHh = z.hh && z.hh[n];
      const hh = ov.세대수 || lzHh || kSum || null;
      const hhSrc = ov.세대수 ? "직접 입력(overrides)" : lzHh ? "생활권 설정(강의자료)" : kSum ? "K-apt" : null;
      const built = cxs.map(x => x.built).filter(Boolean).sort()[0] || (kapt[0] && (KBASIC[kapt[0].code] || {}).use) || null;
      // 대표 평형: 거래(매매+분양권·입주권)가 가장 많은 전용면적(정수)
      const ac = {}; cxs.forEach(x => cnt.forEach((v, k) => { const [i, a] = k.split("|"); if (+i === x.i) ac[a] = (ac[a] || 0) + v; }));
      const rep = Object.entries(ac).sort((a, b) => b[1] - a[1] || Math.abs(a[0] - 84) - Math.abs(b[0] - 84))[0];
      // 정비사업 (이 단지 자체가 정비구역인지)
      const al = tradeNames.map(t => kclean(t, gu, dongs[0])).filter(t => t.length >= 3);
      const jbHit = jbRows.filter(r => dongs.some(d => dkey(d) === dkey(r.dong)) && (() => {
        const names = [r.name].concat((r.name.match(/\((.*?)\)/) || [])[1] || []).map(x => kclean(String(x).replace(/\(.*?\)/g, ""), gu, r.dong)).filter(x => x.length >= 3);
        const jd = digits(r.name), cd = tradeNames.map(t => digits(t.replace(/\(.*?\)/g, "")));
        if (jd.length && cd.some(d => d.length) && !cd.some(d => d.length && d.every(x => jd.includes(x)))) return false;   // 신반포2차 ↔ 신반포22차 같은 오연결 막기
        return names.some(j => al.some(a => a === j || ((a.includes(j) || j.includes(a)) && Math.min(a.length, j.length) >= 3)));
      })());
      const id = kapt.length ? kapt[0].code : `R-${code}-${kclean(base, gu, dongs[0]) || norm(base)}`;
      const item = {
        id, 이름: base, 별칭: tradeNames.filter(x => x !== base), 구: gu, 구코드: code, 동: dongs, 생활권: z.id || null, 생활권이름: z.name,
        세대수: hh ? Number(hh) : null, 세대수출처: hhSrc, 준공: built, 대표평형: rep ? +rep[0] : null,
        kapt: kapt.map(k => ({ 코드: k.code, 이름: k.name, 세대수: (KBASIC[k.code] || {}).cnt || null })),
        실거래: cxs.map(x => ({ 이름: x.name, 동: x.dong })),
        정비사업: jbHit.length ? jbHit.map(r => ({ 코드: r.code, 구역: r.name, 단계: r.stage })) : null,
      };
      item._s = kScore; item._fail = () => {
        const pool = kl.filter(k => dongs.some(d => dkey(d) === dkey(k.dong)));
        const cand = pool.map(k => ({ k, d: Math.max(...tradeNames.map(t => dice(kclean(t, gu, dongs[0]), kclean(k.name, gu, k.dong)))) })).sort((a, b) => b.d - a.d).slice(0, 3);
        return { 구: gu, 생활권: z.name, 단지: base, 실거래명: cxs.map(x => x.name).join("|"), 동: dongs.join("·"), 세대수: item.세대수, 후보: cand.map(c => `${c.k.name}(${c.k.code},${(KBASIC[c.k.code] || {}).cnt || "-"}세대)`) };
      };
      item._rid = `R-${code}-${kclean(base, gu, dongs[0]) || norm(base)}`; item._lzHh = lzHh || null;
      out.push(item);
      if (false) {
        // 보고용 후보: 같은 동 K-apt 중 글자 유사도가 높은 3개
        const pool = kl.filter(k => dongs.some(d => dkey(d) === dkey(k.dong)));
        const cand = pool.map(k => ({ k, d: Math.max(...tradeNames.map(t => dice(kclean(t, gu, dongs[0]), kclean(k.name, gu, k.dong)))) })).sort((a, b) => b.d - a.d).slice(0, 3);
        failKapt.push({ 구: gu, 생활권: z.name, 단지: base, 실거래명: cxs.map(x => x.name).join("|"), 동: dongs.join("·"), 세대수: item.세대수, 후보: cand.map(c => `${c.k.name}(${c.k.code},${(KBASIC[c.k.code] || {}).cnt || "-"}세대)`) });
      }
    });
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
out.forEach(x => { if (!x.kapt.length) failKapt.push(x._fail()); });
const seen = new Set(); out.forEach(x => { if (seen.has(x.id)) x.id += "-" + x.생활권; seen.add(x.id); });   // 규칙 ID가 우연히 겹칠 때
out.forEach(x => { delete x._s; delete x._fail; delete x._rid; delete x._lzHh; });

const meta = (설명) => ({
  설명, 출처: ["국토부 실거래가(docs/data)", "공동주택관리정보시스템 K-apt 단지 목록·기본정보(data/cache/hh_list.json, hh_basic.json)", "서울 열린데이터광장 OA-22856 정비사업", "생활권 설정 docs/lifezones.js(훨훨 강의자료)"],
  기준일: { 자료: lastYm, 갱신: INDEX.updated, 정비사업: JB.asof || "" }, 만든곳: "scripts/build_master.js",
});
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "complexes.json"), JSON.stringify({ ...meta("생활권 대표 단지 마스터. id = K-apt 단지코드(없으면 R-구코드-이름). 세대수출처로 어디서 온 값인지 표시."), 단지: out }));
fs.writeFileSync(path.join(OUT, "jb_zones.json"), JSON.stringify({ ...meta("정비구역 → 생활권 연결표 (사이트 정비사업 탭과 같은 규칙). 생활권이 null이면 연결 못 한 구역."), 구역: zoneJb }));
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ...meta("매칭 실패 목록 (사람이 확인할 것)"), K_apt_못찾음: failKapt, 생활권_못붙인_정비구역: failJbZone, ID_겹침: dups }, null, 1));

const withK = out.filter(x => x.kapt.length).length, noHh = out.filter(x => !x.세대수).length;
console.log(`단지 ${out.length}곳 · K-apt 연결 ${withK} · 못 찾음 ${failKapt.length} · 세대수 없음 ${noHh} · 정비사업 연결 단지 ${out.filter(x => x.정비사업).length} · ID 겹침 ${dups.length}`);
console.log(`정비구역 ${zoneJb.length}곳 · 생활권 연결 ${zoneJb.length - failJbZone.length} · 못 붙임 ${failJbZone.length}`);
