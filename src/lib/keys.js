// API 열쇠는 파일에서만 읽는다. 값을 화면·로그에 찍지 않는다(절대 규칙 7).
// 열쇠 폴더: 환경변수 NEWSPURI_KEYS, 없으면 윈도우 C:\keys, 그 밖은 ~/.keys
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function keyDir() {
  if (process.env.NEWSPURI_KEYS) return process.env.NEWSPURI_KEYS;
  return process.platform === 'win32' ? 'C:\\keys' : path.join(os.homedir(), '.keys');
}

export function readKey(name) {
  const file = path.join(keyDir(), '.' + name);
  if (!fs.existsSync(file)) return null;
  const v = fs.readFileSync(file, 'utf8').trim();
  return v || null;
}
