// 자본 계산기 — 규칙(data/rules.json)으로 매수 가능 가격 계산. 단위: 억 원.
// 화면(mine.html '갈 수 있는 곳')과 검증 스크립트가 같이 씀. 규칙 값은 여기 쓰지 않고 rules.json에서만 읽음.
const CAP = (() => {
  const r1 = v => Math.round(v * 1e4) / 1e4;
  // "(가격억×2/3−3)%" 같은 식 → P(억)를 넣어 비율(소수)을 돌려주는 함수
  function formula(s) {
    const e = String(s).replace(/가격억/g, "P").replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/%\s*$/, "").trim();
    if (!/^[\dP+\-*/(). ]+$/.test(e)) throw new Error("취득세 식을 읽을 수 없음: " + s);
    const f = new Function("P", "return (" + e + ")");
    return P => f(P) / 100;
  }
  const pctOf = s => { const m = String(s).match(/([\d.]+)\s*%/); if (!m) throw new Error("비율을 읽을 수 없음: " + s); return +m[1] / 100; };
  // 원리금균등: 월 상환액 1당 빌릴 수 있는 원금
  const annuity = (rate, years) => { const i = rate / 12, n = years * 12; return i === 0 ? n : (1 - Math.pow(1 + i, -n)) / i; };

  function make(R) {
    const T = R.취득세_1주택, mid = formula(T["6~9억"]), edu = pctOf(T.지방교육세);
    const regulated = !!(R.규제지역 && R.규제지역.서울);
    const ltv = regulated ? R.LTV.규제지역 : R.LTV.비규제;
    const tiers = R.주담대캡_수도권규제.구간;
    const capOf = P => { if (!regulated) return Infinity; const t = tiers.find(t => t.상한가 == null || P <= t.상한가 + 1e-9); return t ? t.한도 : 0; };
    const taxRate = P => P <= 6 + 1e-9 ? T["6억이하"] : P <= 9 + 1e-9 ? mid(P) : T["9억초과"];
    const tax = (P, over85) => { const base = P * taxRate(P); return { 본세: base, 교육세: base * edu, 농특세: over85 ? P * T.농특세_85초과 : 0, 율: taxRate(P) }; };
    const feeRate = P => { const b = R.중개보수_매매.구간; const t = b.find(([lo, hi]) => P >= lo - 1e-9 && (hi == null || P < hi - 1e-9)); return t ? t[2] : b[0][2]; };
    return { R, ltv, regulated, capOf, taxRate, tax, feeRate, tiers };
  }

  // inp: {자본(억), 연소득(억), 기타연상환(억), 월상환(억, 없으면 null), 금리(소수), 전용85초과(bool)}
  function calc(R, inp, opt = {}) {
    const M = make(R), D = R.DSR;
    const rate = inp.금리 != null ? inp.금리 : D.기본금리_가정;
    const dsrLimit = inp.연소득 != null ? Math.max(0, (inp.연소득 * D.은행 - (inp.기타연상환 || 0)) / 12 * annuity(rate + D.스트레스금리_수도권, D.만기년)) : Infinity;
    const monLimit = inp.월상환 != null ? inp.월상환 * annuity(rate, D.만기년) : Infinity;
    const capOf = opt.capOverride || M.capOf;
    function at(P) {
      const parts = { LTV: M.ltv * P, 캡: capOf(P), DSR: dsrLimit, 월상환: monLimit };
      const loan = Math.max(0, Math.min(...Object.values(parts)));
      const by = Object.keys(parts).filter(k => Math.abs(parts[k] - loan) < 1e-9).join("·") || "LTV";
      const t = M.tax(P, inp.전용85초과), fee = P * M.feeRate(P);
      const need = P - loan + t.본세 + t.교육세 + t.농특세 + fee;
      return { 가격: P, 대출: r1(loan), 제약: by, 한도들: parts, 취득세: r1(t.본세 + t.교육세 + t.농특세), 취득세율: t.율, 중개보수: r1(fee), 필요현금: r1(need) };
    }
    // 0.1억 단위로 전 구간 스캔 (절벽 때문에 중간에 막혀도 끝까지 봄)
    const MAXK = opt.maxK || 1000;   // 100억까지
    let best = null, firstBlock = null;
    for (let k = 1; k <= MAXK; k++) {
      const a = at(k / 10);
      if (a.필요현금 <= inp.자본 + 1e-9) best = a;
      else if (!firstBlock && best) firstBlock = a;
    }
    const out = { 금리: rate, DSR한도: dsrLimit, 월상환한도: monLimit, 최대: best, 강의: inp.자본 / (1 - M.ltv), at };
    // 절벽: 캡 구간 경계 b 바로 위가 막혀서 b에 머무는 경우 — 경계 아래 한도가 계속된다면 어디까지 갔을지
    if (best && M.regulated && !opt.capOverride) {
      for (let j = 0; j < M.tiers.length - 1; j++) {
        const b = M.tiers[j].상한가, lowCap = M.tiers[j].한도, highCap = M.tiers[j + 1].한도;
        if (best.가격 > b + 1e-9) continue;
        const above = at(Math.round(b * 10 + 1) / 10);
        if (above.필요현금 <= inp.자본) continue;
        const free = calc(R, inp, { capOverride: P => (P <= b + 1e-9 ? M.capOf(P) : lowCap), maxK: MAXK });
        if (free.최대 && free.최대.가격 > best.가격 + 1e-9) {
          out.절벽 = { 경계: b, 한도전: lowCap, 한도후: highCap, 위: above, 부족: r1(above.필요현금 - inp.자본), 절벽없으면: free.최대.가격 };
        }
        break;
      }
    }
    return out;
  }
  return { make, calc, annuity };
})();
if (typeof module !== "undefined") module.exports = CAP;
