// test-sofascore-via-home-proxy.js
// 집 PC의 프록시(home-proxy-server.js + cloudflared tunnel)를 거쳐 sofascore.com에
// 접근되는지 GitHub Actions에서 테스트하는 스크립트.
//
// footystats와 달리 소파스코어는 "홈페이지는 통과, API는 challenge"였던 이력이 있어서
// (Cloudflare Worker 경유 테스트 때 확인) 이번엔 홈페이지와 실제 API 엔드포인트를
// 각각 따로 찔러서 어디까지 뚫리는지 정확히 구분한다.
//
// 필요한 환경변수:
//   HOME_PROXY_URL:    cloudflared 주소 (footystats 테스트 때와 동일한 값 사용)
//   HOME_PROXY_SECRET: home-proxy-server.js의 PROXY_SECRET과 동일한 값
//
// 실행: node test-sofascore-via-home-proxy.js

const HOME_PROXY_URL = (process.env.HOME_PROXY_URL || '').trim();
const HOME_PROXY_SECRET = (process.env.HOME_PROXY_SECRET || '').trim();

const TARGETS = [
  { label: '1) 홈페이지', url: 'https://www.sofascore.com/' },
  { label: '2) 실제 API (팀 검색)', url: 'https://www.sofascore.com/api/v1/search/all?q=Manchester%20United' },
];

async function testTarget(label, targetUrl) {
  console.log(`\n=== ${label} ===`);
  console.log(`대상: ${targetUrl}`);

  const proxiedUrl = `${HOME_PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
  try {
    const res = await fetch(proxiedUrl, {
      headers: { 'X-Proxy-Secret': HOME_PROXY_SECRET },
    });
    const text = await res.text();
    const upstreamStatus = res.headers.get('x-upstream-status');

    console.log(`프록시 응답 HTTP 상태: ${res.status}`);
    console.log(`실제 sofascore.com 응답 상태(X-Upstream-Status): ${upstreamStatus}`);
    console.log(`응답 길이: ${text.length}자`);
    console.log(`응답 앞부분:\n${text.slice(0, 300)}`);

    const looksChallenge = /Just a moment|challenges\.cloudflare\.com|"reason":\s*"challenge"|"reason":\s*"Forbidden"/i.test(text);
    const hasRealData = text.includes('Manchester United') || text.includes('sofascore') || text.includes('"results"');

    console.log(`판정: ${looksChallenge ? '❌ 차단/챌린지 응답으로 보임' : hasRealData ? '✅ 실제 데이터 포함됨 (성공!)' : '⚠️ 불명확 - 위 응답을 직접 확인하세요'}`);
  } catch (err) {
    console.log(`❌ 요청 자체가 실패함: ${err.message}`);
  }
}

async function main() {
  if (!HOME_PROXY_URL || !HOME_PROXY_SECRET) {
    console.error('❌ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }
  console.log(`경유 주소: ${HOME_PROXY_URL}/proxy?url=...`);
  for (const t of TARGETS) {
    await testTarget(t.label, t.url);
  }
}

main();