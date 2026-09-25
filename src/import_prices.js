// 주가 넣기 — CSV(종목코드,날짜YYYYMMDD,종가) → price 표
//
//   node src/import_prices.js 파일.csv --source krx
//
// 허락 대장에서 그 출처가 allow=예 여야 한다. 시장지수는 종목코드를 IDX_KOSPI · IDX_KOSDAQ 로 적는다.
import { openDb } from './lib/db.js';
import { requireAllowed } from './lib/ledger.js';
import { readCsv } from './lib/csv.js';

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const i = process.argv.indexOf('--source');
const source = i >= 0 ? process.argv[i + 1] : null;
if (!file || !source) { console.error('쓰는 법: node src/import_prices.js 파일.csv --source krx'); process.exit(2); }
requireAllowed(source);

const db = openDb();
const ins = db.prepare('INSERT OR REPLACE INTO price VALUES (?,?,?,?)');
let n = 0, bad = 0;
db.exec('BEGIN');
for (const r of readCsv(file)) {
  const code = r['종목코드'], day = (r['날짜'] || '').replace(/-/g, ''), close = Number(String(r['종가']).replace(/,/g, ''));
  if (!code || !/^\d{8}$/.test(day) || !(close > 0)) { bad++; continue; }
  ins.run(code, day, close, source); n++;
}
db.exec('COMMIT');
console.log(`[끝] 넣은 줄 ${n} · 버린 줄 ${bad} (칸이 비었거나 숫자가 아님)`);
