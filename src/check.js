// 점검 — 화면에 나갈 자료(web/today.json)와 화면(web/index.html)이 규칙을 지키는지 본다.
//
//   node src/check.js            점검. 하나라도 어긋나면 [점검 실패] 로 끝난다(종료 코드 1)
//   node src/check.js --deploy   공개 배포용 점검 — 견본(가짜) 카드가 섞여 있어도 실패
//
// 보는 것
//   ① 모든 화면에 «투자 자문이 아닙니다» 안내가 있나(절대 규칙 1)
//   ② 해석마다 근거가 있고, 근거 문장이 원문에 글자 그대로 있나(규칙 5)
//   ③ 쉬운 말이 3줄인가 · 금지말(매수·매도 권유, 주가 단정)이 없나(규칙 1)
//   ④ 숫자에 출처와 기준 시각이 붙었나(규칙 4) · 표본 30건 미만 값이 실리지 않았나
//   ⑤ 허락 대장: allow=예 인 줄에 근거가 적혀 있나(규칙 2)
import fs from 'node:fs';
import { openDb } from './lib/db.js';
import { readCsv } from './lib/csv.js';
import { problemsOf, findForbidden } from './lib/rules.js';
import { p } from './lib/paths.js';

const DEPLOY = process.argv.includes('--deploy');
const fails = [], warns = [];
const fail = m => fails.push(m), warn = m => warns.push(m);
const DISCLAIMER = '투자 자문이 아닙니다';

// ① 화면 안내 문구
for (const f of fs.readdirSync(p('web')).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(p('web', f), 'utf8');
  if (!html.includes(DISCLAIMER)) fail(`${f}: «${DISCLAIMER}» 안내 문구가 없습니다`);
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ');
  for (const w of findForbidden(visible)) fail(`${f}: 화면 글에 금지말 ${w}`);
}

// ②③④ 카드
const todayFile = p('web/today.json');
if (!fs.existsSync(todayFile)) fail('web/today.json 이 없습니다 — build_web.js 를 먼저 돌리세요');
else {
  const data = JSON.parse(fs.readFileSync(todayFile, 'utf8'));
  const db = openDb();
  const docOf = db.prepare('SELECT text FROM document WHERE rcept_no=?');
  let sample = 0;
  for (const c of data.cards) {
    const who = `${c.corp_name} ${c.title}`;
    if (c.sample) sample++;
    const doc = docOf.get(c.rcept_no)?.text
      ?? (c.sample && fs.existsSync(p(`fixtures/sample_docs/${c.rcept_no}.txt`)) ? fs.readFileSync(p(`fixtures/sample_docs/${c.rcept_no}.txt`), 'utf8') : null);
    if (doc == null) fail(`${who}: 원문이 보관돼 있지 않아 근거를 대조할 수 없습니다`);
    for (const pr of problemsOf(c, doc)) fail(`${who}: ${pr}`);
    for (const w of findForbidden(c.tone_reason)) fail(`${who}: 판단 이유에 금지말 ${w}`);
    for (const e of c.evidence || []) if (!/^(https:\/\/dart\.fss\.or\.kr\/|\/sample\/)/.test(e.link || '')) fail(`${who}: 근거 링크가 원문을 가리키지 않습니다`);
    if (!c.source || !c.date) fail(`${who}: 공시의 출처나 날짜가 없습니다`);
    const h = c.history;
    if (h?.items?.some(i => i.median != null)) {
      if (!h.source || !h.period || !h.computed_at) fail(`${who}: 과거 움직임 숫자에 출처·기간·셈한 때가 없습니다`);
      if (!(h.n >= 30)) fail(`${who}: 표본 ${h.n}건인데 값이 실렸습니다(30건 이상만)`);
      if (!c.sample && h.sample) fail(`${who}: 실제 공시에 견본 통계가 붙었습니다`);
    }
  }
  if (sample) (DEPLOY ? fail : warn)(`견본(가짜) 카드 ${sample}장 — 공개 배포 금지`);
  if (!data.cards.length) warn('오늘 카드가 0장입니다');
}

// ⑤ 허락 대장
for (const r of readCsv(p('config/sources.csv'))) {
  if (r.allow === '예' && !r['근거']) fail(`허락 대장 «${r['이름']}»: allow=예 인데 근거가 비었습니다`);
  if (r.allow === '예' && r['확인한사람'] === '대표 확인 전') warn(`허락 대장 «${r['이름']}»: 대표 확인 전입니다`);
}

for (const w of warns) console.log(`  [주의] ${w}`);
for (const f of fails) console.log(`  [어긋남] ${f}`);
if (fails.length) { console.log(`[점검 실패] 어긋남 ${fails.length}건`); process.exit(1); }
console.log(`[점검 통과]${warns.length ? ` (주의 ${warns.length}건)` : ''}`);
