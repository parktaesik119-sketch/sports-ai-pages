// test-footystats-via-home-proxy.js
// 집 PC의 프록시(home-proxy-server.js + cloudflared tunnel)를 거쳐 footystats.org에
// 접근되는지 GitHub Actions에서 테스트하는 스크립트.
//
// 필요한 환경변수:
//   HOME_PROXY_URL:    cloudflared가 출력한 임시 주소 (예: https://xxxxx.trycloudflare.com)
//   HOME_PROXY_SECRET: home-proxy-server.js를 실행할 때 설정한 PROXY_SECRET과 동일한 값
//
// 실행: node test-footystats-via-home-proxy.js

const TARGET_URL = 'https://footystats.org/clubs/galway-united-fc-2052';

const HOME_PROXY_URL = (process.env.HOME_PROXY_URL || '').trim();
const HOME_PROXY_SECRET = (process.env.HOME_PROXY_SECRET || '').trim();

async function main() {
  if (!HOME_PROXY_URL || !HOME_PROXY_SECRET) {
    console.error('❌ HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  const proxiedUrl = `${HOME_PROXY_URL}/proxy?url=${encodeURIComponent(TARGET_URL)}`;
  console.log(`대상 URL: ${TARGET_URL}`);
  console.log(`경유 주소: ${HOME_PROXY_URL}/proxy?url=...`);

  try {
    const res = await fetch(proxiedUrl, {
      headers: { 'X-Proxy-Secret': HOME_PROXY_SECRET },
    });
    const text = await res.text();
    const upstreamStatus = res.headers.get('x-upstream-status');

    console.log(`\n프록시 응답 HTTP 상태: ${res.status}`);
    console.log(`실제 footystats.org 응답 상태(X-Upstream-Status): ${upstreamStatus}`);
    console.log(`응답 길이: ${text.length}자`);
    console.log(`응답 앞부분:\n${text.slice(0, 500)}`);

    const hasRealData = text.includes('Galway United');
    const looksChallenge = /Just a moment|challenges\.cloudflare\.com/i.test(text);

    console.log(`\n판정: ${hasRealData ? '✅ 실제 팀 데이터 포함됨 (성공!)' : looksChallenge ? '❌ 여전히 Cloudflare 챌린지 페이지' : '⚠️ 불명확 - 응답 앞부분을 직접 확인하세요'}`);
  } catch (err) {
    console.error(`❌ 요청 자체가 실패함: ${err.message}`);
  }
}

main();