// 받아 둔 공시가 어떤 종류로 몇 건인지 — Claude 해석(돈이 드는 일) 전에 양을 가늠한다
//   node src/stats.js            공시가 있었던 최근 하루
//   node src/stats.js --days 3   최근 3일
import { openDb } from './lib/db.js';
import { eventTypes } from './lib/classify.js';

const i = process.argv.indexOf('--days');
const days = i >= 0 ? Number(process.argv[i + 1]) : 1;
const db = openDb();
const dates = db.prepare("SELECT DISTINCT rcept_dt d FROM disclosure WHERE source='dart' ORDER BY d DESC LIMIT ?").all(days).map(r => r.d);
if (!dates.length) { console.log('받아 둔 실제 공시가 없습니다. 먼저 npm.cmd run fetch'); process.exit(0); }
const since = dates[dates.length - 1];
const rows = db.prepare(`SELECT d.event_type t, COUNT(*) n, SUM(i.rcept_no IS NOT NULL) done,
  SUM(d.stock_code<>'') listed FROM disclosure d LEFT JOIN interpretation i ON i.rcept_no=d.rcept_no
  WHERE d.source='dart' AND d.rcept_dt>=? GROUP BY d.event_type ORDER BY n DESC`).all(since);
const name = Object.fromEntries(eventTypes().map(t => [t['코드'], t['이름']]));
console.log(`공시일 ${dates.slice().reverse().join(', ')}\n`);
console.log('  전체  상장사  해석됨  종류');
let total = 0, todo = 0;
for (const r of rows) {
  console.log(`${String(r.n).padStart(6)}${String(r.listed).padStart(8)}${String(r.done).padStart(8)}  ${name[r.t] || r.t}`);
  total += r.n; if (r.t !== 'OTHER') todo += r.listed - r.done;
}
console.log(`\n전체 ${total}건 · 해석 대상(상장사 · «기타» 빼고 · 아직 안 한 것) ${todo}건`);
console.log('처음에는 npm.cmd run interpret -- --limit 5 처럼 조금만 돌려 보세요.');
