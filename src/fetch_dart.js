// DART 공시 목록 수집기 → data/news.db 의 disclosure 표
//
//   node src/fetch_dart.js              최근 3일
//   node src/fetch_dart.js --days 7     최근 7일
//   node src/fetch_dart.js --from 20260901 --to 20260925
//   node src/fetch_dart.js --type B      공시 종류 하나만(B 주요사항보고 · I 거래소공시 · D 지분공시 …) — 5년치를 받을 때 호출 수를 줄인다
//   node src/fetch_dart.js --again      이어받기 장부를 무시하고 처음부터
//   node src/fetch_dart.js --sample     견본(가짜) 공시로 시험 — 인터넷·열쇠 필요 없음
//
// 지키는 것
// - 허락 대장(config/sources.csv)에서 allow=예 인지 먼저 본다.
// - 응답의 status 를 반드시 본다. 020(요청 한도 초과)은 «0건»이 아니다 — 쉬고 다시, 그래도 안 되면 멈춘다.
// - 끝낸 쪽을 fetch_done 에 적어 이어받는다. 단 «오늘»은 공시가 계속 늘어 끝났다고 적지 않는다.
// - 어떻게 끝나든 «받은 칸 N/M» 을 적는다(아무 말 없이 끝나면 다 받았는지 알 수 없다).
import fs from 'node:fs';
import { openDb, now } from './lib/db.js';
import { requireAllowed } from './lib/ledger.js';
import { readKey, keyDir } from './lib/keys.js';
import { classify, isFix } from './lib/classify.js';
import { p } from './lib/paths.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = k => args.includes(k);

const db = openDb();
const insert = db.prepare(`INSERT OR IGNORE INTO disclosure
  (rcept_no, corp_code, corp_name, stock_code, corp_cls, report_nm, rcept_dt, flr_nm, rm, event_type, is_fix, source, fetched_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

function save(row, source) {
  const r = insert.run(row.rcept_no, row.corp_code, row.corp_name, row.stock_code || '', row.corp_cls,
    row.report_nm, row.rcept_dt, row.flr_nm, row.rm || '', classify(row.report_nm), isFix(row.report_nm) ? 1 : 0,
    source, now());
  return r.changes;
}

// ── 견본 모드 ────────────────────────────────────────────────
if (has('--sample')) {
  requireAllowed('sample');
  const list = JSON.parse(fs.readFileSync(p('fixtures/sample_list.json'), 'utf8'));
  let added = 0;
  for (const row of list) added += save(row, 'sample');
  console.log(`[견본] 가짜 공시 ${list.length}건 중 새로 저장 ${added}건 (실제 회사·실제 공시 아님)`);
  console.log(`[끝] 받은 칸 1/1 · 새 공시 ${added}건`);
  process.exit(0);
}

// ── 실제 DART ────────────────────────────────────────────────
requireAllowed('dart');
const KEY = readKey('dartkey');
if (!KEY) {
  console.error(`[멈춤] DART 열쇠 파일이 없습니다: ${keyDir()} 폴더의 .dartkey`);
  console.error('       https://opendart.fss.or.kr 에서 직접 로그인해 «인증키 신청»을 하고, 받은 열쇠를 그 파일에 한 줄로 넣으세요.');
  process.exit(2);
}

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const today = ymd(new Date(Date.now() + 9 * 3600e3)); // 한국 시각 기준 오늘
function dayList() {
  const from = opt('--from'), to = opt('--to') || today;
  const days = [];
  const start = from
    ? new Date(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6)}T00:00:00Z`)
    : new Date(Date.parse(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6)}T00:00:00Z`) - (Number(opt('--days') || 3) - 1) * 864e5);
  for (let d = start; ymd(d) <= to; d = new Date(+d + 864e5)) days.push(ymd(d));
  return days;
}

const TY = opt('--type');
const SRC = 'dart' + (TY ? ':' + TY : ''); // 이어받기 장부의 이름 — 종류마다 따로 적는다

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isDone = db.prepare('SELECT 1 FROM fetch_done WHERE source=? AND day=? AND page=?');
const markDone = db.prepare('INSERT OR REPLACE INTO fetch_done VALUES (?,?,?,?,?,?)');
if (has('--again')) db.prepare('DELETE FROM fetch_done WHERE source=?').run(SRC);

// DART 상태 코드: 000 정상 · 013 자료 없음 · 020 요청 한도 초과 · 010/011 열쇠 문제 · 800 점검 · 900 기타
async function getPage(day, page) {
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(KEY)}`
    + `&bgn_de=${day}&end_de=${day}&page_no=${page}&page_count=100` + (TY ? `&pblntf_ty=${TY}` : '');
  for (let attempt = 1; attempt <= 6; attempt++) {
    let j;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      j = await res.json();
    } catch (e) {
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`  [다시] ${day} ${page}쪽 연결 실패(${e.name}) — ${wait / 1000}초 쉬고 ${attempt}/6`);
      await sleep(wait); continue;
    }
    if (j.status === '000') return j;
    if (j.status === '013') return { list: [], total_page: 0, total_count: 0 };
    if (j.status === '020' || j.status === '800') {
      const wait = 5000 * 2 ** (attempt - 1);
      console.warn(`  [쉼] ${day} ${page}쪽 — DART 가 «${j.message}»(${j.status}). ${wait / 1000}초 쉬고 ${attempt}/6`);
      await sleep(wait); continue;
    }
    throw new Error(`DART 오류 ${j.status}: ${j.message}`); // 열쇠 문제 등은 기다려도 안 풀린다
  }
  throw new Error('여섯 번 다시 해도 안 됨 — 하루 호출 한도일 수 있습니다. 내일 이어받으세요.');
}

const days = dayList();
const stat = { cells: 0, doneCells: 0, added: 0, stoppedAt: null, error: null };
process.on('exit', () => {
  const tail = stat.error ? ` · ${stat.stoppedAt || '처음'} 에서 끊김(${stat.error}) — 같은 명령을 다시 돌리면 이어받습니다` : '';
  console.log(`[끝] 받은 칸 ${stat.doneCells}/${stat.cells} (날짜×쪽) · 새 공시 ${stat.added}건${tail}`);
});

try {
  for (const day of days) {
    // 1쪽을 받아야 그날 몇 쪽인지 안다
    if (day !== today && isDone.get(SRC, day, 1)) {
      const row = db.prepare('SELECT total_page FROM fetch_done WHERE source=? AND day=? AND page=1').get(SRC, day);
      const total = Math.max(1, row.total_page);
      const missing = [];
      for (let pg = 1; pg <= total; pg++) if (!isDone.get(SRC, day, pg)) missing.push(pg);
      stat.cells += total; stat.doneCells += total - missing.length;
      if (!missing.length) continue;
      for (const pg of missing) await one(day, pg, total);
      continue;
    }
    stat.stoppedAt = `${day} 1쪽`;
    const first = await getPage(day, 1);
    stat.stoppedAt = null;
    const total = Math.max(1, Number(first.total_page) || 0);
    stat.cells += total;
    record(day, 1, total, first);
    for (let pg = 2; pg <= total; pg++) {
      if (day !== today && isDone.get(SRC, day, pg)) { stat.doneCells++; continue; }
      await one(day, pg, total);
    }
  }
} catch (e) {
  stat.error = e.message;
  console.error(`[멈춤] ${e.message}`);
  process.exitCode = 1;
}

async function one(day, pg, total) {
  stat.stoppedAt = `${day} ${pg}쪽`;
  const j = await getPage(day, pg);
  record(day, pg, total, j);
  stat.stoppedAt = null;
}

function record(day, pg, total, j) {
  let added = 0;
  for (const row of j.list || []) added += save(row, 'dart');
  stat.added += added; stat.doneCells++;
  if (day !== today) markDone.run(SRC, day, pg, total, (j.list || []).length, now());
  console.log(`  ${day} ${pg}/${total}쪽 · ${(j.list || []).length}건 (새 ${added})`);
}
