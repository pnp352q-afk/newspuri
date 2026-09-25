// API 열쇠는 파일에서만 읽는다. 값을 화면·로그에 찍지 않는다(절대 규칙 7).
// 열쇠 폴더: 환경변수 NEWSPURI_KEYS, 없으면 윈도우 C:\keys, 그 밖은 ~/.keys
// 메모장은 이름 뒤에 .txt 를 몰래 붙이곤 한다 — «.dartkey.txt» 도 받아 준다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function keyDir() {
  if (process.env.NEWSPURI_KEYS) return process.env.NEWSPURI_KEYS;
  return process.platform === 'win32' ? 'C:\\keys' : path.join(os.homedir(), '.keys');
}

// 돌려주는 것: 열쇠 글자, 없으면 null. 왜 없는지는 keyProblem() 이 말한다.
export function readKey(name) {
  for (const f of candidates(name)) {
    if (!fs.existsSync(f)) continue;
    const v = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim();
    if (v) return v;
  }
  return null;
}

export function keyProblem(name) {
  const found = candidates(name).filter(f => fs.existsSync(f));
  if (!found.length) {
    let others = [];
    try { others = fs.readdirSync(keyDir()); } catch { return `${keyDir()} 폴더가 없습니다.`; }
    return `${keyDir()} 폴더에 .${name} 파일이 없습니다. 지금 폴더에 있는 것: ${others.length ? others.join(', ') : '(비어 있음)'}`;
  }
  return `${found[0]} 파일은 있는데 비어 있습니다. 열쇠를 붙여 넣고 저장했는지 확인하세요.`;
}

const candidates = name => [path.join(keyDir(), '.' + name), path.join(keyDir(), '.' + name + '.txt')];
