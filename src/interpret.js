// 공시 해석기 — 공시 원문 → {사건 종류, 호재/악재 쪽, 놀라움 정도, 쉬운 말 3줄, 근거 문장}
//
//   node src/interpret.js             공시가 있었던 가장 최근 하루치를 Claude 로 해석(연휴·주말은 건너뜀)
//   node src/interpret.js --days 3    공시가 있었던 최근 3일
//   node src/interpret.js --limit 20  한 번에 최대 20건(비용 조절). 상장사 공시만 한다
//   node src/interpret.js --sample    견본 공시를 «규칙»으로 해석(열쇠·인터넷 필요 없음)
//
// 지키는 것
// - 같은 공시는 한 번만 해석해 interpretation 표에 둔다(비용 절약).
// - 근거 문장이 원문에 글자 그대로 없거나, 금지말이 있으면 저장하지 않는다(절대 규칙 1·5).
// - «오른다/내린다»를 단정하지 않는다. 판단은 «호재 쪽/악재 쪽/중립/판단 어려움» 네 칸.
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { openDb, now } from './lib/db.js';
import { eventTypes } from './lib/classify.js';
import { problemsOf } from './lib/rules.js';
import { readKey, keyProblem } from './lib/keys.js';
import { unzip, xmlToText } from './lib/unzip.js';
import { p } from './lib/paths.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const SAMPLE = args.includes('--sample');
const CFG = JSON.parse(fs.readFileSync(p('config/llm.json'), 'utf8'));
const TYPES = eventTypes();
const typeOf = code => TYPES.find(t => t['코드'] === code);

const db = openDb();
const save = db.prepare('INSERT OR REPLACE INTO interpretation VALUES (?,?,?,?,?)');
const saveDoc = db.prepare('INSERT OR REPLACE INTO document VALUES (?,?,?)');

// 달력이 아니라 «공시가 실제로 있었던 날» 기준 — 추석·주말처럼 0건인 날에 걸려 빈손이 되지 않게
// 해석 차례 = config/event_types.csv 의 줄 차례(기획자가 위아래로 옮겨 정한다)
const typeOrder = 'CASE d.event_type ' + TYPES.map((t, i) => `WHEN '${t['코드'].replace(/'/g, '')}' THEN ${i}`).join(' ') + ' ELSE 999 END';
const since = db.prepare(`SELECT MIN(d) d FROM (SELECT DISTINCT rcept_dt d FROM disclosure WHERE source='dart'
  ORDER BY d DESC LIMIT ?)`).get(Number(opt('--days') || 1))?.d || '99999999';
const todo = db.prepare(`SELECT d.* FROM disclosure d LEFT JOIN interpretation i ON i.rcept_no = d.rcept_no
  WHERE i.rcept_no IS NULL AND d.event_type <> 'OTHER' AND d.source = ? AND d.rcept_dt >= ?
    AND (d.source = 'sample' OR d.stock_code <> '')  -- 상장사만: 주가가 없으면 «과거 움직임»을 붙일 수 없다
  ORDER BY ${typeOrder} , d.rcept_dt DESC, d.rcept_no DESC LIMIT ?`).all(SAMPLE ? 'sample' : 'dart', SAMPLE ? '0' : since, Number(opt('--limit') || 50));

// ── 원문 가져오기 ─────────────────────────────────────────────
async function docText(d, key) {
  if (d.source === 'sample') return fs.readFileSync(p(`fixtures/sample_docs/${d.rcept_no}.txt`), 'utf8');
  const res = await fetch(`https://opendart.fss.or.kr/api/document.xml?crtfc_key=${encodeURIComponent(key)}&rcept_no=${d.rcept_no}`,
    { signal: AbortSignal.timeout(60000) });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`원문 대신 오류가 왔습니다: ${buf.toString('utf8', 0, 200)}`);
  return unzip(buf).map(f => xmlToText(f.data.toString('utf8'))).join('\n\n');
}

// ── 해석의 틀 ────────────────────────────────────────────────
const Schema = z.object({
  event_type: z.enum(TYPES.map(t => t['코드'])),
  tone: z.enum(['호재 쪽', '악재 쪽', '중립', '판단 어려움']),
  tone_reason: z.string(),
  surprise: z.enum(['낮음', '보통', '높음', '알 수 없음']),
  easy: z.array(z.string()),
  evidence: z.array(z.object({ quote: z.string(), why: z.string() })),
});

const SYSTEM = `너는 주식 공시를 일반인에게 풀어 주는 해설가다. 투자 자문가가 아니다.

지킬 것:
- 쉬운 말(easy)은 정확히 3줄. 초등학생도 알아듣게, 한 줄에 60자 안쪽. 전문용어는 옆에 쉬운 말을 붙인다.
  1줄: 무슨 일인가 · 2줄: 왜 중요한가(주주에게 어떤 뜻인가) · 3줄: 그래서 무엇을 더 확인해야 하나.
- 주가가 오른다/내린다고 단정하지 않는다. 사라/팔라고 권하지 않는다. 목표가·수익률 예측을 하지 않는다.
- tone 은 «이런 공시가 흔히 어떻게 읽히는가»이지 예측이 아니다. 원문만으로 판단이 어려우면 «판단 어려움».
- surprise 는 원문 안의 숫자(예: 매출액 대비 계약 규모, 발행주식 대비 신주 비율)로만 판단한다.
  시장 기대치 같은 원문에 없는 정보가 필요하면 «알 수 없음».
- evidence.quote 는 원문에서 글자 그대로 옮긴 한 구절(표 칸이면 칸 하나). 고치거나 줄이거나 합치지 않는다.
  근거는 1~3개. easy 의 모든 숫자는 evidence 안에 있어야 한다.
- 원문에 없는 사실을 지어내지 않는다.`;

async function viaClaude(client, d, text) {
  const t = typeOf(d.event_type);
  const res = await client.beta.messages.parse({
    model: CFG.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: CFG.effort, format: betaZodOutputFormat(Schema) },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `회사: ${d.corp_name} (${d.corp_cls === 'Y' ? '유가증권' : d.corp_cls === 'K' ? '코스닥' : '기타'})\n`
        + `공시 제목: ${d.report_nm}\n`
        + `우리 분류표의 추정 종류: ${d.event_type} (${t?.['이름'] || ''}) — 원문을 보고 틀리면 고쳐라\n`
        + `이 종류의 흔한 해석: ${t?.['흔한해석'] || ''} / 주의: ${t?.['주의'] || ''}\n\n`
        + `<원문>\n${text}\n</원문>`,
    }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`해석 거절(${res.stop_details?.category ?? '분류 없음'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('답이 길어 잘렸습니다');
  if (!res.parsed_output) throw new Error('정해진 틀로 답하지 않았습니다');
  return { it: res.parsed_output, model: res.model };
}

// 견본용 «규칙 해석기» — LLM 없이 분류표 글로 같은 틀을 채운다
function viaRules(d, text) {
  const t = typeOf(d.event_type);
  const lines = text.split('\n').map(s => s.trim()).filter(s => /\d/.test(s) && /^\d+\./.test(s));
  const tone = { '호재 경향': '호재 쪽', '짧은 호재 경향': '호재 쪽', '악재 경향': '악재 쪽' }[t['흔한해석']] || '판단 어려움';
  return {
    model: '규칙(견본)',
    it: {
      event_type: d.event_type, tone, tone_reason: `이런 공시는 흔히 «${t['흔한해석']}»으로 읽힌다(분류표 기준).`,
      surprise: '알 수 없음',
      easy: [`${d.corp_name}: ${t['쉬운설명']}`, t['주의'] || '회사 설명을 끝까지 읽어 볼 만하다.', `숫자로는 ${lines[1] ? lines[1].replace(/^\d+\.\s*/, '') : '원문을 확인할 것'}.`],
      evidence: lines.slice(0, 2).map(q => ({ quote: q, why: '원문의 핵심 숫자' })),
    },
  };
}

// ── 돌리기 ───────────────────────────────────────────────────
let client = null, key = null;
if (!SAMPLE) {
  key = readKey('dartkey');
  if (!key) { console.error(`[멈춤] DART 열쇠를 읽지 못했습니다 — ${keyProblem('dartkey')}`); process.exit(2); }
  // Claude 열쇠: 환경변수 ANTHROPIC_API_KEY 가 있으면 그것, 없으면 열쇠 폴더의 .anthropickey
  const ak = process.env.ANTHROPIC_API_KEY ? null : readKey('anthropickey');
  if (!process.env.ANTHROPIC_API_KEY && !ak) { console.error(`[멈춤] Claude 열쇠를 읽지 못했습니다 — ${keyProblem('anthropickey')}`); process.exit(2); }
  client = ak ? new Anthropic({ apiKey: ak }) : new Anthropic();
}

let ok = 0, bad = 0;
for (const d of todo) {
  try {
    const text = await docText(d, key);
    if (text.length > CFG.max_doc_chars) { console.warn(`  [보류] ${d.corp_name} ${d.report_nm} — 원문이 너무 깁니다(${text.length}자). 자르지 않고 건너뜀`); bad++; continue; }
    const { it, model } = SAMPLE ? viaRules(d, text) : await viaClaude(client, d, text);
    const probs = problemsOf(it, text);
    if (probs.length) { console.warn(`  [버림] ${d.corp_name} ${d.report_nm}\n         ${probs.join('\n         ')}`); bad++; continue; }
    saveDoc.run(d.rcept_no, text, now());
    save.run(d.rcept_no, JSON.stringify(it), model, d.source, now());
    if (it.event_type !== d.event_type) db.prepare('UPDATE disclosure SET event_type=? WHERE rcept_no=?').run(it.event_type, d.rcept_no);
    console.log(`  [해석] ${d.corp_name} · ${d.report_nm} → ${it.tone}`);
    ok++;
  } catch (e) {
    console.warn(`  [실패] ${d.corp_name} ${d.report_nm} — ${e.message}`); bad++;
  }
}
console.log(`[끝] 해석 ${ok}건 · 못 한 것 ${bad}건 · 대상 ${todo.length}건${SAMPLE ? ' (견본)' : ''}`);
