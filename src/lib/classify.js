// 공시 제목 → 사건 종류. 규칙은 config/event_types.csv 가 정본(기획자 편집).
// DART 제목은 가운뎃점이 «ㆍ»(U+318D)라 «·»와 섞인다 — 띄어쓰기·점을 모두 지우고 견준다.
import { readCsv } from './csv.js';
import { p } from './paths.js';

const norm = s => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/[\s·ㆍ・()（）]/g, '');

let TYPES;
export function eventTypes() {
  if (!TYPES) TYPES = readCsv(p('config/event_types.csv'));
  return TYPES;
}

export function classify(reportNm) {
  const t = norm(reportNm);
  for (const row of eventTypes()) {
    if (!row['찾는말']) continue;
    const hit = row['찾는말'].split('|').some(k => t.includes(norm(k)));
    const out = row['빼는말'] && row['빼는말'].split('|').some(k => t.includes(norm(k)));
    if (hit && !out) return row['코드'];
  }
  return 'OTHER';
}

export const isFix = reportNm => /\[(기재정정|첨부정정|정정)/.test(String(reportNm || ''));
