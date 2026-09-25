# 뉴스풀이

주가에 영향을 주는 공시를 쉬운 말로 풀어 주는 서비스. **투자 자문이 아닙니다.**

> 이어받는 분은 **[docs/02-인수인계.md](docs/02-인수인계.md)** 부터 읽으세요.

## 처음 한 번 (내 PC)

1. [Node.js](https://nodejs.org) 22.5 이상을 설치합니다.
2. 이 폴더에서 터미널(PowerShell)을 열고 붙여 넣기: `npm install`

## 견본으로 화면 보기 (열쇠 필요 없음)

PowerShell 에 한 줄씩:

```
npm run sample
npm run serve
```

브라우저에서 http://127.0.0.1:3320 을 엽니다. 카드마다 «견본 — 실제 아님» 표시가 붙어 있습니다.

## 실제 공시로 돌리기

1. https://opendart.fss.or.kr 에 **직접** 로그인해 «인증키 신청» → 받은 열쇠를 `C:\keys\.dartkey` 파일에 한 줄로 저장
2. Claude API 열쇠를 `C:\keys\.anthropickey` 에 저장(또는 환경변수 `ANTHROPIC_API_KEY`)
3. 한 줄씩:

```
npm run fetch
npm run interpret
npm run build
npm run check
```

과거 주가(사건 연구)는 KRX 이용 조건을 확인해 `config/sources.csv` 에 허락을 적은 뒤에 넣습니다. 자세한 규칙은 `CLAUDE.md`.
