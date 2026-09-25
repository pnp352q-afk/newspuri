// 사건 연구 — «과거에 같은 종류 공시가 난 뒤 주가가 시장보다 얼마나 더(덜) 움직였나»
//
//   node src/event_study.js           실제 자료로 셈(내 PC 에서 — 무거운 계산은 서버에서 하지 않는다)
//   node src/event_study.js --demo    견본(가짜) 값으로 화면 시험 — 화면에 «견본» 표시가 붙는다
//
// 셈법 (docs/00-구현기록.md 에도 적음)
//   t  = 공시 접수일(휴장일이면 다음 거래일)
//   초과수익률(N일) = (종목 종가[t+N−1] / 종목 종가[t−1] − 1) − (시장지수[t+N−1] / 시장지수[t−1] − 1)
//     (1일 = 공시 당일 하루의 움직임 · 5일 = 당일 포함 5거래일)
//     시장지수: 유가증권(Y) → IDX_KOSPI · 코스닥(K) → IDX_KOSDAQ  (price 표의 code)
//   기준을 t−1 종가로 잡는 까닭: DART 목록에는 접수 «시각»이 없어, 장중 공시의 첫 반응을 놓치지 않으려고.
//   N = 1·5·20 거래일 · 기간 = 최근 5년 · 정정 공시는 뺀다(같은 사건을 두 번 세지 않으려고)
//   값 = 중앙값(평균은 한두 건의 폭등·폭락에 끌려간다) · 표본 30건 미만이면 값을 싣지 않는다(«자료 부족»)
import { openDb, now } from './lib/db.js';
import { eventTypes } from './lib/classify.js';

const HORIZONS = [1, 5, 20];
const MIN_N = 30;
const db = openDb();
const upsert = db.prepare('INSERT OR REPLACE INTO event_stats VALUES (?,?,?,?,?,?,?,?)');

if (process.argv.includes('--demo')) {
  // 견본: 화면 시험용 가짜 값. 실제 통계가 아니다(source='sample').
  const demo = {
    RIGHTS_ISSUE: [-2.1, -3.4, -4.0, 412], CONVERTIBLE: [-1.2, -2.0, -2.6, 655], BUYBACK: [0.9, 1.1, 0.8, 388],
    CANCEL: [1.4, 1.9, 2.2, 97], CONTRACT: [1.8, 1.2, 0.3, 2140], EARNINGS: [0.2, 0.3, 0.1, 5230],
    INSIDER: [-0.1, -0.2, -0.4, 8800], DIVIDEND: [0.3, 0.2, 0.0, 1420], MERGER: [null, null, null, 21],
  };
  db.exec("DELETE FROM event_stats WHERE source='sample'");
  for (const [type, [a1, a5, a20, n]] of Object.entries(demo)) {
    [a1, a5, a20].forEach((v, i) => upsert.run(type, HORIZONS[i], n < MIN_N ? null : v, n, '2021-09-25', '2026-09-25', 'sample', now()));
  }
  console.log(`[견본] 가짜 사건 연구 값 ${Object.keys(demo).length}종 저장 — 실제 통계 아님`);
  process.exit(0);
}

// ── 실제 셈 ──────────────────────────────────────────────────
const priceCount = db.prepare('SELECT COUNT(*) n FROM price').get().n;
if (!priceCount) {
  console.error('[자료 부족] price 표가 비어 있습니다. 주가 자료가 있어야 셀 수 있습니다.');
  console.error('            KRX 이용 조건을 확인해 허락 대장에 allow=예 로 적은 뒤, node src/import_prices.js 로 넣으세요.');
  process.exit(0);
}

// 종목별 거래일·종가를 메모리에 (5년 × 2,500종목 × 250일 ≈ 300만 줄 — PC 에서는 충분하다)
const since = new Date(Date.now() - 5 * 365.25 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const series = new Map();
for (const r of db.prepare('SELECT code, day, close FROM price ORDER BY code, day').iterate()) {
  let s = series.get(r.code);
  if (!s) series.set(r.code, s = { days: [], close: [] });
  s.days.push(r.day); s.close.push(r.close);
}

// 정렬된 거래일 배열에서 day 이상인 첫 칸
function firstOnOrAfter(days, day) {
  let lo = 0, hi = days.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] < day) lo = m + 1; else hi = m; }
  return lo;
}

function ret(s, day, n) {
  const t = firstOnOrAfter(s.days, day);
  if (t < 1 || t + n - 1 >= s.days.length) return null;
  // t 가 공시일과 너무 멀면(거래정지 등) 쓰지 않는다
  if (s.days[t] > addDays(day, 7)) return null;
  return s.close[t + n - 1] / s.close[t - 1] - 1;
}
const addDays = (d, k) => new Date(Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z`) + k * 864e5)
  .toISOString().slice(0, 10).replace(/-/g, '');

const median = a => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

const rows = db.prepare(`SELECT stock_code, corp_cls, rcept_dt, event_type FROM disclosure
  WHERE source='dart' AND is_fix=0 AND stock_code<>'' AND corp_cls IN ('Y','K') AND rcept_dt>=?`).all(since);

const bucket = new Map(); // type → {1:[],5:[],20:[]}
let skipped = 0;
for (const r of rows) {
  const s = series.get(r.stock_code);
  const m = series.get(r.corp_cls === 'Y' ? 'IDX_KOSPI' : 'IDX_KOSDAQ');
  if (!s || !m) { skipped++; continue; }
  const b = bucket.get(r.event_type) || Object.fromEntries(HORIZONS.map(h => [h, []]));
  bucket.set(r.event_type, b);
  for (const h of HORIZONS) {
    const a = ret(s, r.rcept_dt, h), mk = ret(m, r.rcept_dt, h);
    if (a != null && mk != null) b[h].push((a - mk) * 100);
  }
}

db.exec("DELETE FROM event_stats WHERE source<>'sample'");
const src = db.prepare('SELECT DISTINCT source FROM price').all().map(r => r.source).join('+');
const to = new Date().toISOString().slice(0, 10);
const fromIso = `${since.slice(0, 4)}-${since.slice(4, 6)}-${since.slice(6)}`;
for (const t of eventTypes()) {
  const b = bucket.get(t['코드']);
  for (const h of HORIZONS) {
    const arr = b ? b[h] : [];
    upsert.run(t['코드'], h, arr.length >= MIN_N ? +median(arr).toFixed(2) : null, arr.length, fromIso, to, src, now());
  }
  const n = b ? b[1].length : 0;
  console.log(`  ${t['이름'].padEnd(12)} 표본 ${String(n).padStart(5)}건 ${n < MIN_N ? '— 자료 부족' : ''}`);
}
console.log(`[끝] 공시 ${rows.length}건 중 주가를 못 찾아 뺀 것 ${skipped}건`);
