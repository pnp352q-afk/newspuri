// 해석 한 건이 규칙을 지키는지 — interpret.js(저장 전)와 check.js(배포 전) 가 같이 쓴다.
import { readCsv } from './csv.js';
import { p } from './paths.js';

const squash = s => String(s || '').replace(/\s+/g, '');
let FORBIDDEN;
export function forbidden() {
  if (!FORBIDDEN) FORBIDDEN = readCsv(p('config/forbidden.csv'));
  return FORBIDDEN;
}

// 글 속 금지말 찾기(띄어쓰기를 무시하고 견준다)
export function findForbidden(text) {
  const t = squash(text);
  return forbidden().filter(r => t.includes(squash(r['금지말']))).map(r => `«${r['금지말']}»(${r['까닭']})`);
}

// 문제 목록을 돌려준다 — 비어 있으면 통과
export function problemsOf(it, docText) {
  const out = [];
  if (!it || typeof it !== 'object') return ['해석이 비었습니다'];
  if (!Array.isArray(it.easy) || it.easy.length !== 3 || it.easy.some(s => !String(s).trim())) out.push('쉬운 말이 3줄이 아닙니다');
  if (!Array.isArray(it.evidence) || !it.evidence.length) out.push('근거 문장이 없습니다');
  else if (docText != null) {
    const doc = squash(docText);
    for (const ev of it.evidence) {
      const q = squash(ev.quote);
      if (q.length < 4) out.push(`근거가 너무 짧습니다: «${ev.quote}»`);
      else if (!doc.includes(q)) out.push(`근거 문장이 원문에 없습니다: «${String(ev.quote).slice(0, 40)}»`);
    }
  }
  const all = [...(it.easy || []), ...(it.evidence || []).map(e => e.why)].join(' ');
  for (const f of findForbidden(all)) out.push(`금지말 ${f}`);
  return out;
}
