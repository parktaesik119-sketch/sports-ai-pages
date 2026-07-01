# 스포츠 뉴스 Worker 배포 가이드

## 1. 준비물
- Node.js 18+
- Cloudflare 계정 (무료 플랜)

## 2. 설치

```bash
cd worker
npm install -g wrangler   # 이미 설치돼 있으면 생략
wrangler login             # 브라우저에서 Cloudflare 로그인
```

## 3. KV 네임스페이스 생성

```bash
wrangler kv namespace create NEWS_KV
```

실행하면 아래처럼 출력됩니다:
```
{ binding = "NEWS_KV", id = "abcd1234...", ... }
```

이 `id` 값을 `wrangler.toml`의 `id = "여기에_실제_KV_namespace_id_입력"` 자리에 그대로 붙여넣으세요.

## 4. 네이버 API 키 등록 (Secrets)

```bash
wrangler secret put NAVER_CLIENT_ID
# 프롬프트가 뜨면 Client ID 값 붙여넣고 엔터

wrangler secret put NAVER_CLIENT_SECRET
# 프롬프트가 뜨면 Client Secret 값 붙여넣고 엔터
```

> 등록 후에는 값을 다시 조회할 수 없습니다 (write-only). 잊어버리면 재발급 후 다시 등록하면 됩니다.

## 5. 로컬 테스트

```bash
wrangler dev
```

브라우저에서 확인:
- `http://localhost:8787/api/articles?sport=soccer` — 축구 기사 목록 (최초엔 빈 배열일 수 있음, 크론이 아직 안 돌았으므로)
- 수동으로 크론 한 번 돌려보기:
  ```bash
  curl -X POST http://localhost:8787/api/cron-trigger
  ```
  이후 다시 `/api/articles?sport=soccer` 호출하면 데이터가 채워져 있어야 합니다.

## 6. 배포

```bash
wrangler deploy
```

배포되면 `https://sports-news-worker.{your-subdomain}.workers.dev` 같은 URL이 나옵니다.
이 URL이 프론트엔드(`news-board.html`)에서 호출할 API 주소입니다.

## 7. 크론 동작 확인

Cloudflare 대시보드 → Workers → 해당 Worker → "Triggers" 탭에서 크론이 정상 등록됐는지 확인 가능합니다.
30분마다 자동 실행되며, 처음 배포 직후에는 크론이 도는 시점까지 기다리거나 위 `cron-trigger` 엔드포인트로 수동 실행해서 초기 데이터를 채울 수 있습니다.

## 8. 프론트엔드 연동 (다음 단계)

`news-board.html`의 목업 데이터(`ARTICLES` 배열)를 아래처럼 실제 API 호출로 교체하면 됩니다:

```js
async function loadArticles() {
  const res = await fetch('https://sports-news-worker.{your-subdomain}.workers.dev/api/articles');
  const data = await res.json();
  // data.articles = { soccer: [...], baseball: [...], ... }
}
```

이 작업은 아직 안 돼 있고, 다음 단계로 남아있습니다.

## 참고: API 엔드포인트 요약

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/articles` | GET | 전체 종목 기사 반환 |
| `/api/articles?sport=soccer` | GET | 특정 종목만 반환 (soccer/baseball/basketball/volleyball/hockey/lol) |
| `/api/cron-trigger` | POST | 수동으로 크론 실행 (테스트/디버그용, 운영 시 접근 제한 권장) |
