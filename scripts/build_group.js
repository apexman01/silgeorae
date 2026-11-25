#!/usr/bin/env node
/*
 * 시세 그룹(docs/beta/group.html)용 전세 자료 — 시세 요약 파일과 같은 단지에 전세 시세를 붙인다
 *
 *   node scripts/build_group.js                          → docs/beta/data/group/jeonse.json (시험판)
 *   node scripts/build_group.js --out docs/data/group --no-patch   (정식 반영 시)
 *
 * - 단지 매칭은 build_summary.js와 같은 규칙 (lifezones.js 단지명, '|' 합침, '@동' 지정, 띄어쓰기 무시)
 * - 면적: 59㎡(55~66), 84㎡(80~90)
 * - 전세 시세 = 신규 계약(갱신 제외)의 최근 6개월 중간값. 6개월에 3건 미만이면 12개월로 넓힘.
 * - 같은 보증금이 3건 이상 반복되면(단지 안 공공임대·장기전세 물량) 빼고 계산.
 * - 시세 요약 파일(summary/)과 docs/data/ 형식은 건드리지 않는다. 새 파일만 만든다.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(ROOT, argVal("--out") || "docs/beta/data/group");
const USE_PATCH = !args.includes("--no-patch");

const AREAS = { "84": [80, 90], "59": [55, 66] };
const norm = s => String(s).replace(/\s+/g, "").toLowerCase();
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
function runInto(win, file) { const ctx = { window: win, console }; vm.createContext(ctx); vm.runInContext(read(file), ctx); }

const win = {};
runInto(win, "docs/data/index.js");
runInto(win, "docs/lifezones.js");
if (USE_PATCH && fs.existsSync(path.join(ROOT, "docs/beta/lifezones_patch.js"))) runInto(win, "docs/beta/lifezones_patch.js");
const INDEX = win.DATA_INDEX, LZ = win.LIFEZONES;
const months = INDEX.months, lastYm = months[months.length - 1];
const from6 = months[Math.max(0, months.length - 6)], from12 = months[Math.max(0, months.length - 12)];
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

const out = {};
for (const [gu, code] of Object.entries(INDEX.regions["서울특별시"])) {
  if (!fs.existsSync(path.join(ROOT, `docs/data/${code}.js`))) continue;
  const w = {}; runInto(w, `docs/data/${code}.js`);
  const D = w.DATA_GU[gu];
  const CX = D.complexes.map((c, i) => ({ i, name: c[0], dong: c[3] }));
  const byIdx = new Map();
  D.jeonse.forEach(r => { if (r[6]) return; if (!byIdx.has(r[0])) byIdx.set(r[0], []); byIdx.get(r[0]).push(r); });   // 신규만
  const G = out[gu] = {};
  ((LZ["서울특별시"] || {})[gu] || []).forEach(z => {
    const Z = G[z.name] = {};
    z.complexes.forEach(n => {
      const parts = n.split("|").map(p => { const [nm, dong] = p.split("@"); return { nm: norm(nm), dong }; });
      const cxs = CX.filter(x => parts.some(p => p.nm === norm(x.name) && (!p.dong || x.dong.startsWith(p.dong))));
      const base = (z.short && z.short[n]) || n.split("|")[0].split("@")[0];
      const rows = []; cxs.forEach(x => (byIdx.get(x.i) || []).forEach(r => rows.push(r)));
      const item = {};
      for (const [key, [lo, hi]] of Object.entries(AREAS)) {
        const rs = rows.filter(r => r[1] >= lo && r[1] < hi);
        let use = rs.filter(r => r[2] >= from6), span = 6;
        if (use.length < 3) { use = rs.filter(r => r[2] >= from12); span = 12; }
        const cnt = {}; use.forEach(r => cnt[r[4]] = (cnt[r[4]] || 0) + 1);
        const clean = use.filter(r => cnt[r[4]] < 3);
        if (clean.length) use = clean;
        if (use.length) item[key] = { 중간값: median(use.map(r => r[4])), 건수: use.length, 기간개월: span };
      }
      if (Object.keys(item).length) Z[base] = item;
    });
  });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "jeonse.json"), JSON.stringify({
  설명: "시세 그룹용 전세 시세. 구 > 생활권 > 단지(시세 요약 파일의 '이름') > 59/84. 중간값 단위 만원. 신규 계약만, 최근 6개월(3건 미만이면 12개월), 같은 보증금 3건 이상 반복(임대 물량)은 제외.",
  기준월: lastYm, 자료갱신: INDEX.updated, 구: out,
}));
console.log(`전세 시세 → ${path.relative(ROOT, OUT)}/jeonse.json (기준월 ${lastYm})`);
