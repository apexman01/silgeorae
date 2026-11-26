// 시세트래킹: 내 유닛들의 네이버페이부동산 매매 호가를 읽어 저장하고, 전일과 비교해 리포트·알림
//
// 실행:  node track.js                 (units.json 전체 그룹)
//        node track.js --group "서울 13개 단지"
//        node track.js --show          (브라우저 창을 띄워서 보기)
//        node track.js --report-only   (수집 없이 최근 두 자료로 리포트만)
//
// 결과:  data/YYYY-MM-DD.json   (그날 자료)
//        reports/YYYY-MM-DD.md  (리포트)
//        메일 알림: 환경변수 GMAIL_USER, GMAIL_APP_PASSWORD, (선택) ALERT_TO 설정 시

const fs = require('fs');
const path = require('path');
const { parseListings, summarize, tags } = require('./parse');

const DIR = __dirname;
// tracker/.env 의 KEY=VALUE 를 읽음 (메일 설정용, 저장소에 올라가지 않음)
try {
  for (const line of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const DATA = path.join(DIR, 'data');
const REPORTS = path.join(DIR, 'reports');
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const ymd = d => kst(d).toISOString().slice(0, 10);
const hm = d => kst(d).toISOString().slice(11, 16);
const DAYS = '일월화수목금토';
const mdw = s => { const d = new Date(s + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAYS[d.getUTCDay()]})`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadUnits() {
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'units.json'), 'utf8'));
  const want = opt('--group');
  const groups = {};
  for (const [g, list] of Object.entries(cfg.groups)) if (!want || g === want) groups[g] = list;
  if (!Object.keys(groups).length) throw new Error(`그룹 없음: ${want}`);
  return groups;
}

// ---------- 수집 ----------
async function readComplex(page, id) {
  const url = `https://fin.land.naver.com/complexes/${id}?tab=article&articleTradeTypes=A1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  let last = -1, same = 0, total = null;
  for (let i = 0; i < 300 && same < 5; i++) {
    const r = await page.evaluate(() => {
      // 페이지 안에서 스크롤되는 영역을 전부 끝까지 내림 (매물 목록이 옆 패널에 있을 수 있음)
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 40) {
          const s = getComputedStyle(el).overflowY;
          if (s === 'auto' || s === 'scroll') el.scrollTop = el.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
      const t = document.body.innerText;
      const m = t.match(/매물\s*([\d,]+)\s*개/);
      return { n: (t.match(/(^|\n)\s*매매\s+\d/g) || []).length, total: m ? +m[1].replace(/,/g, '') : null };
    });
    total = r.total;
    if (r.n === last) same++; else { same = 0; last = r.n; }
    if (total && r.n >= total) break;
    await page.waitForTimeout(900 + Math.random() * 600);
  }
  const text = await page.evaluate(() => document.body.innerText);
  if (/upstream request failed|접근이 제한|비정상적인 접근/.test(text) && last <= 0) {
    throw new Error('네이버가 응답하지 않음(접속 차단 가능성)');
  }
  return { text, total };
}

async function collect(groups) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: !flag('--show') });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'ko-KR' });
  const now = new Date();
  const snap = { date: ymd(now), time: hm(now), units: {} };
  for (const list of Object.values(groups)) {
    for (const u of list) {
      if (snap.units[u.id]) continue;
      process.stdout.write(`- ${u.name} (${u.id}) ... `);
      try {
        const { text, total } = await readComplex(page, u.id);
        const listings = parseListings(text);
        snap.units[u.id] = { name: u.name, total, read: listings.length, summary: summarize(listings, u.areas), listings };
        console.log(`매매 ${total ?? '?'}건 중 ${listings.length}건 읽음`);
      } catch (e) {
        snap.units[u.id] = { name: u.name, error: String(e.message || e) };
        console.log(`실패: ${e.message}`);
      }
      await sleep(2500 + Math.random() * 2500); // 천천히 (사람 속도)
    }
  }
  await browser.close();
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, `${snap.date}.json`), JSON.stringify(snap, null, 1));
  return snap;
}

// ---------- 리포트 ----------
const f = v => (v == null ? '-' : (Math.round(v * 100) / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '.0'));
function diffText(d) {
  const a = Math.abs(d);
  const s = d > 0 ? '+' : '−';
  return a >= 1 ? `${s}${f(a)}억` : `${s}${Math.round(a * 10000).toLocaleString()}만`;
}
const key = m => m && `${m.dong}|${m.floor}|${m.area}`;

function buildReport(groups, today, prev) {
  const out = [];
  const changes = [];
  for (const [g, list] of Object.entries(groups)) {
    out.push(`## 🏢 ${mdw(today.date)} ${g} 최저 호가`);
    out.push(`### ${today.time} KST 조회${prev ? ` · 전일(${mdw(prev.date)}) 대비` : ' · 첫 수집(비교 자료 없음)'}`);
    out.push('');
    const rows = [];
    for (const u of list) {
      const t = today.units[u.id];
      const p = prev && prev.units[u.id];
      const labels = Object.keys(u.areas);
      if (!t || t.error) { rows.push(`- **${u.gu ? u.gu + ' · ' : ''}${u.name}** 수집 실패${t ? `: ${t.error}` : ''}`); continue; }
      const cells = labels.map(l => {
        const m = t.summary[l].min;
        const pm = p && !p.error && p.summary[l] && p.summary[l].min;
        if (!m) return '매물 없음';
        let mark = '(—)';
        if (pm) {
          const d = m.price - pm.price;
          const swap = key(m) !== key(pm);
          if (Math.abs(d) > 1e-6) {
            mark = `(${d > 0 ? '🔺' : '🔻'}${diffText(d)}${swap ? ', 교체' : ''})`;
            changes.push({ d, line: `${d > 0 ? '🔺' : '🔻'} ${u.name} ${l}㎡ ${f(pm.price)}억→${f(m.price)}억(${diffText(d)}, ${swap ? '최저 매물 교체' : '같은 매물 가격 조정'}${tags(m).length ? `, ${tags(m).join('·')}` : ''})` });
          } else if (swap) mark = '(—, 교체)';
        }
        const extra = tags(m).filter(x => x !== '하락');
        const mv = t.summary[l].moveInMin;
        const mvTxt = extra.includes('세안고') && mv ? `, 입주 ${f(mv.price)}` : '';
        return `${f(m.price)} ${mark}${extra.length ? ` ${extra.join('·')}` : ''}${mvTxt}`;
      });
      const mins = labels.map(l => t.summary[l].min && t.summary[l].min.price);
      const gap = mins.length === 2 && mins[0] && mins[1] ? ` · 격차 ${f(mins[1] - mins[0])}억` : '';
      const warn = t.total && t.read < t.total ? ` ⚠️${t.read}/${t.total}건만 읽음` : '';
      rows.push(`- **${u.gu ? u.gu + ' · ' : ''}${u.name}**${labels.join('/') !== '59/84' ? `(${labels.join('/')}㎡)` : ''} ${cells.join(' / ')}${gap}${warn}`);
    }
    if (prev) {
      out.push('### 주요 변동');
      const c = changes.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      out.push(...(c.length ? c.map(x => x.line) : ['변동 없음']));
      out.push('');
    }
    out.push(`### 단지별 최저가 (억)`);
    out.push(...rows);
    out.push('');
    changes.length = 0;
  }
  return out.join('\n');
}

function hasChanges(report) { return /[🔺🔻]/u.test(report); }

async function sendMail(subject, body) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return false;
  const nodemailer = require('nodemailer');
  const tr = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  await tr.sendMail({ from: GMAIL_USER, to: ALERT_TO || GMAIL_USER, subject, text: body });
  return true;
}

function latestTwo() {
  if (!fs.existsSync(DATA)) return [];
  return fs.readdirSync(DATA).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().slice(-2)
    .map(x => JSON.parse(fs.readFileSync(path.join(DATA, x), 'utf8')));
}

(async () => {
  const groups = loadUnits();
  let today, prev;
  if (flag('--report-only')) {
    [prev, today] = latestTwo();
    if (!today) { today = prev; prev = null; }
    if (!today) throw new Error('data/ 에 자료가 없습니다');
  } else {
    const before = latestTwo().filter(s => s.date !== ymd()).pop() || null;
    today = await collect(groups);
    prev = before;
  }
  const report = buildReport(groups, today, prev);
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, `${today.date}.md`), report);
  console.log('\n' + report);
  if (prev && (hasChanges(report) || flag('--always-mail'))) {
    const sent = await sendMail(`[시세트래킹] ${mdw(today.date)} 호가 변동`, report).catch(e => (console.log('메일 실패:', e.message), false));
    if (sent) console.log('\n메일 알림 보냄');
  }
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
