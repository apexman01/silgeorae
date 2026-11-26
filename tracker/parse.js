// 네이버페이부동산 단지 매물 화면 글자 → 매물 목록
// 화면 글자(innerText)와 Firecrawl 마크다운 둘 다 읽을 수 있게 느슨하게 만듦

function toEok(s) {
  // "23억 5,000" → 23.5, "9,500" → 0.95, 범위 "A ~ B"는 A
  s = s.split('~')[0];
  const m = s.match(/(?:(\d+)억)?\s*([\d,]+)?/);
  if (!m || (!m[1] && !m[2])) return null;
  const eok = m[1] ? parseInt(m[1], 10) : 0;
  const man = m[2] ? parseInt(m[2].replace(/,/g, ''), 10) : 0;
  return Math.round((eok + man / 10000) * 10000) / 10000;
}

function parseListings(text) {
  const lines = text
    .split('\n')
    .map(l => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(l => l && l !== '-');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const pm = lines[i].match(/^매매\s+(\d[\d억,\s~]*)/);
    if (!pm) continue;
    const price = toEok(pm[1]);
    if (price == null) continue;
    const item = {
      price,
      priceText: pm[1].trim(),
      dong: '',
      area: null,
      supply: null,
      floor: '',
      dir: '',
      note: '',
      confirmed: '',
      agents: 1,
      articleId: '',
      down: /하락/.test(lines[i]),
    };
    const prev = lines[i - 1] || '';
    const dm = prev.match(/(\S+동)\s*$/);
    if (dm) item.dong = dm[1];
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
      const l = lines[j];
      if (/^매매\s+\d/.test(l)) break;
      let m;
      if ((m = l.match(/([\d.]+)[A-Za-z]*㎡\s*\(전용\s*([\d.]+)/))) { item.supply = +m[1]; item.area = +m[2]; continue; }
      if ((m = l.match(/^(\S+\/\d+층)/))) { item.floor = m[1]; continue; }
      if (/^[동서남북]+향$/.test(l)) { item.dir = l; continue; }
      if ((m = l.match(/^"(.*)"$/))) { item.note = m[1]; continue; }
      if ((m = l.match(/확인매물\s*([\d.]+)/))) { item.confirmed = m[1]; continue; }
      if ((m = l.match(/중개사\s*(\d+)곳/))) { item.agents = +m[1]; continue; }
      if ((m = l.match(/articles\/(\d+)/))) { item.articleId = m[1]; continue; }
    }
    if (item.area) out.push(item);
  }
  return out;
}

// 메모·문구에서 조건 뽑기
function tags(item) {
  const t = `${item.note}`;
  const r = [];
  if (/세\s*안고|세안고|전세\s*끼|전세안고|임대\s*승계|승계/.test(t)) r.push('세안고');
  if (/입주\s*가능|즉시\s*입주|공실|빈집|바로\s*입주/.test(t)) r.push('입주가능');
  if (/급매/.test(t)) r.push('급매');
  if (item.down) r.push('하락');
  return r;
}

// 평형별 최저가
function summarize(listings, areas) {
  const res = {};
  for (const [label, [lo, hi]] of Object.entries(areas)) {
    const pool = listings.filter(x => x.area >= lo && x.area < hi).sort((a, b) => a.price - b.price);
    const min = pool[0] || null;
    const moveIn = pool.find(x => tags(x).includes('입주가능')) || null;
    res[label] = {
      count: pool.length,
      min: min && { ...min, tags: tags(min) },
      moveInMin: moveIn && { price: moveIn.price, dong: moveIn.dong, floor: moveIn.floor },
    };
  }
  return res;
}

module.exports = { toEok, parseListings, summarize, tags };
