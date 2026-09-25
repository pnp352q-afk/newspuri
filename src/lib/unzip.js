// DART 원문(document.xml)은 ZIP 으로 온다. 바깥 부품 없이 중앙 목차를 읽어 풀어 낸다.
import zlib from 'node:zlib';

export function unzip(buf) {
  // 중앙 목차 끝 표시(0x06054b50)를 뒤에서 찾는다
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP 이 아닙니다');
  const count = buf.readUInt16LE(e + 10);
  let c = buf.readUInt32LE(e + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(c) !== 0x02014b50) throw new Error('ZIP 목차가 깨졌습니다');
    const method = buf.readUInt16LE(c + 10), size = buf.readUInt32LE(c + 20);
    const nameLen = buf.readUInt16LE(c + 28), extraLen = buf.readUInt16LE(c + 30), cmtLen = buf.readUInt16LE(c + 32);
    const off = buf.readUInt32LE(c + 42);
    const name = buf.toString('utf8', c + 46, c + 46 + nameLen);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + size);
    files.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    c += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

// DART XML → 사람이 읽는 글. 표 칸은 « | » 로 잇고 줄은 살린다.
export function xmlToText(xml) {
  return xml
    .replace(/<(TD|TE|TH|TU)[^>]*>/gi, ' | ')
    .replace(/<\/(P|TR|TITLE|SECTION-\d|TABLE)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
