// 허락 대장 — config/sources.csv 에 allow=예 인 출처만 수집할 수 있다.
// 대장에 없거나 allow 가 «예»가 아니면 여기서 멈춘다(절대 규칙 2).
import { readCsv } from './csv.js';
import { p } from './paths.js';

export function requireAllowed(source) {
  const row = readCsv(p('config/sources.csv')).find(r => r['출처'] === source);
  if (!row) {
    console.error(`[멈춤] 허락 대장(config/sources.csv)에 «${source}» 줄이 없습니다. 줄을 더하고 근거를 적은 뒤 다시 돌리세요.`);
    process.exit(2);
  }
  if (row.allow !== '예') {
    console.error(`[멈춤] «${row['이름']}» 은 허락 대장에서 allow=${row.allow || '(빈칸)'} 입니다. 수집하지 않습니다.`);
    process.exit(2);
  }
  if (!row['근거']) {
    console.error(`[멈춤] «${row['이름']}» 의 근거 칸이 비어 있습니다.`);
    process.exit(2);
  }
  return row;
}
