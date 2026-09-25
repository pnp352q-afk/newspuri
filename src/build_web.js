// 화면 자료 만들기 — DB 에서 «가장 최근 공시일»의 해석 카드를 뽑아 web/today.json 으로
// 서버는 이 파일을 보여 주기만 한다(무거운 계산은 PC 에서).
import fs from 'node:fs';
import { openDb } from './lib/db.js';
import { eventTypes } from './lib/classify.js';
import { p } from './lib/paths.js';

const db = openDb();
const HORIZONS = [1, 5, 20];
const typeName = Object.fromEntries(eventTypes().map(t => [t['코드'], t['이름']]));

// 실제(DART) 해석이 하나라도 있으면 실제만, 없을 때만 견본을 보여 준다 — 한 화면에 섞지 않는다
const SRC = db.prepare("SELECT 1 FROM interpretation WHERE source='dart' LIMIT 1").get() ? 'dart' : 'sample';
const last = db.prepare("SELECT MAX(rcept_dt) d FROM disclosure WHERE event_type<>'OTHER' AND source=?").get(SRC).d;
if (!last) { console.error('[멈춤] 공시가 없습니다. 먼저 fetch_dart.js 를 돌리세요.'); process.exit(2); }

const rows = db.prepare(`SELECT d.*, i.json, i.model, i.created_at FROM disclosure d
  JOIN interpretation i ON i.rcept_no = d.rcept_no WHERE d.rcept_dt = ? AND d.source = ? ORDER BY d.rcept_no`).all(last, SRC);
const pending = db.prepare(`SELECT COUNT(*) n FROM disclosure d LEFT JOIN interpretation i ON i.rcept_no=d.rcept_no
  WHERE d.rcept_dt=? AND d.source=? AND d.event_type<>'OTHER' AND i.rcept_no IS NULL`).get(last, SRC).n;

// 같은 종류 공시의 과거 움직임 — 실제 자료가 있으면 실제, 없으면 견본. 둘을 섞지 않는다.
function statsOf(type, wantSample) {
  const all = db.prepare('SELECT * FROM event_stats WHERE event_type=? ORDER BY horizon').all(type);
  const real = all.filter(r => r.source !== 'sample');
  const use = real.length ? real : (wantSample ? all.filter(r => r.source === 'sample') : []);
  if (!use.length) return { status: '자료 없음' };
  const r0 = use[0];
  return {
    sample: r0.source === 'sample',
    source: r0.source === 'sample' ? '견본(가짜 값 — 실제 통계 아님)' : `주가: ${r0.source} · 공시: DART`,
    period: `${r0.period_from} ~ ${r0.period_to}`,
    computed_at: r0.computed_at,
    n: r0.n,
    items: HORIZONS.map(h => { const r = use.find(x => x.horizon === h); return { days: h, median: r?.median_ar ?? null }; }),
  };
}

const link = d => d.source === 'sample' ? `/sample/${d.rcept_no}.txt` : `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`;
const cards = rows.map(d => {
  const it = JSON.parse(d.json);
  return {
    rcept_no: d.rcept_no, corp_name: d.corp_name, stock_code: d.stock_code,
    market: { Y: '유가증권', K: '코스닥', N: '코넥스' }[d.corp_cls] || '기타',
    title: d.report_nm, date: d.rcept_dt, is_fix: !!d.is_fix, sample: d.source === 'sample',
    type: it.event_type, type_name: typeName[it.event_type] || it.event_type,
    tone: it.tone, tone_reason: it.tone_reason, surprise: it.surprise, easy: it.easy,
    evidence: it.evidence.map(e => ({ ...e, link: link(d) })),
    source: d.source === 'sample' ? '견본 공시(가짜)' : '금융감독원 DART',
    interpreted_by: d.model, interpreted_at: d.created_at,
    history: statsOf(it.event_type, d.source === 'sample'),
  };
});

const out = { generated_at: new Date().toISOString(), date: last, pending, cards };
fs.writeFileSync(p('web/today.json'), JSON.stringify(out, null, 1));
console.log(`[끝] ${last} 공시 카드 ${cards.length}장 · 해석 대기 ${pending}건 → web/today.json`);
