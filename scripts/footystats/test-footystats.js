// test-footystats.js
// footystats.org가 서버사이드(비-브라우저) 요청을 막는지 로컬에서 확인하는 테스트 스크립트.
// 실행: node test-footystats.js
//
// 두 가지 방식으로 각각 찔러보고 결과를 비교한다.
// 1) 헤더 없이 완전 기본 fetch (가장 "봇스러운" 요청)
// 2) 브라우저를 흉내낸 헤더 포함 fetch
//
// 둘 다 로컬(집 IP)에서 막히면 → IP 문제가 아니라 요청 자체(헤더/TLS/JS챌린지 등)가
// 문제라는 뜻이라, GitHub Actions에서도 100% 막힐 거라고 봐도 됨.
// 로컬에서는 되는데 GitHub Actions에서만 막히면 → 데이터센터 IP 차단일 가능성이 높음.

const TARGET_URL = 'https://footystats.org/clubs/galway-united-fc-2052';

const BROWSER_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Referer': 'https://footystats.org/',
  'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

async function testFetch(label, headers) {
  console.log(`\n=== ${label} ===`);
  try {
    const res = await fetch(TARGET_URL, { headers });
    const text = await res.text();
    console.log(`HTTP 상태: ${res.status}`);
    console.log(`응답 길이: ${text.length}자`);
    console.log(`응답 앞부분:\n${text.slice(0, 500)}`);

    // 실제 팀 데이터(예: "Galway United")가 응답 안에 있는지로 성공 여부 판단
    const looksBlocked = /captcha|cloudflare|access denied|blocked|just a moment/i.test(text) && !text.includes('Galway United');
    const hasRealData = text.includes('Galway United');
    console.log(`\n판정: ${hasRealData ? '✅ 실제 팀 데이터 포함됨 (성공으로 보임)' : looksBlocked ? '❌ 차단/챌린지 페이지로 보임' : '⚠️ 불명확 - 위 응답 앞부분을 직접 확인해보세요'}`);
  } catch (err) {
    console.log(`❌ 요청 자체가 실패함: ${err.message}`);
  }
}

async function main() {
  console.log(`대상 URL: ${TARGET_URL}`);
  await testFetch('1) 헤더 없이 기본 fetch', {});
  await testFetch('2) 브라우저 흉내낸 헤더 포함 fetch', BROWSER_HEADERS);
}

main();