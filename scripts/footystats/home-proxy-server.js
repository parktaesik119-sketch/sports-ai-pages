// home-proxy-server.js
// 집 PC(주거용 IP)에서 돌리는 범용 프록시 서버.
// GitHub Actions(데이터센터 IP)가 Cloudflare 챌린지에 막히는 사이트(footystats.org, sofascore.com 등)를
// 이 서버를 거쳐 호출하면, 실제 요청은 이 PC의 주거용 IP로 나가기 때문에 통과될 가능성이 높다.
//
// 실행: node home-proxy-server.js
// (환경변수 PROXY_SECRET을 미리 설정해두거나, 아래 DEFAULT_SECRET을 직접 바꿔서 써도 됨)
//
// 외부 노출은 Cloudflare Tunnel로 한다:
//   cloudflared tunnel --url http://localhost:8787
// 위 명령을 실행하면 https://xxxxx.trycloudflare.com 같은 임시 주소가 나오는데,
// 그 주소를 GitHub Actions 쪽 HOME_PROXY_URL 시크릿에 넣으면 된다.

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = process.env.PORT || 8787;
const PROXY_SECRET = process.env.PROXY_SECRET || 'CHANGE_ME_TO_A_RANDOM_STRING';

// 오픈 프록시로 악용되지 않도록, 이 목록에 있는 호스트로만 나갈 수 있게 제한한다.
// 새 사이트를 뚫어야 할 때는 여기에 호스트만 추가하면 됨.
const ALLOWED_HOSTS = new Set([
  'footystats.org',
  'cdn.footystats.org',
  'www.sofascore.com',
  'img.sofascore.com',
]);

// GitHub Actions 쪽에서 보낸 헤더 중, 실제 대상 사이트로 그대로 실어 넘길 것들만 화이트리스트로 고른다.
const FORWARD_HEADERS = [
  'accept', 'accept-language', 'user-agent', 'referer', 'origin', 'cookie',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
];

// 리다이렉트(301/302/303/307/308)를 만나면 Location을 따라 최대 5번까지 재요청한다.
// footystats.org의 H2H URL은 "홈팀-vs-원정팀" 순서가 아니라 자기들만의 고정 순서를
// 쓰는 것으로 보여서(팀 ID 기준 추정), 순서가 어긋나면 올바른 URL로 301 리다이렉트를
// 해준다 — 그런데 지금까지는 이 리다이렉트를 안 따라가고 그냥 끊어버리고 있었다.
// (실사용 테스트로 원인 확정, 2026-07)
function makeUpstreamRequest(target, method, headers, body, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const upstreamReq = https.request(target, { method, headers }, (upstreamRes) => {
      const chunks = [];
      upstreamRes.on('data', (c) => chunks.push(c));
      upstreamRes.on('end', () => {
        const status = upstreamRes.statusCode;
        const location = upstreamRes.headers['location'];

        if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
          let redirectUrl;
          try {
            redirectUrl = new URL(location, target); // location이 상대경로여도 처리됨
          } catch {
            return resolve({ statusCode: status, headers: upstreamRes.headers, body: Buffer.concat(chunks) });
          }

          // 리다이렉트 대상도 허용된 호스트인지 다시 확인(오픈 프록시로 악용 방지)
          if (!ALLOWED_HOSTS.has(redirectUrl.hostname)) {
            return resolve({ statusCode: status, headers: upstreamRes.headers, body: Buffer.concat(chunks) });
          }

          console.log(`[${new Date().toISOString()}]   ↳ 리다이렉트(${status}) 감지 → ${redirectUrl.toString()}`);
          // 301/302/303은 관례적으로 GET 요청으로 전환, 307/308만 원래 메서드+바디 유지
          const nextMethod = (status === 307 || status === 308) ? method : 'GET';
          const nextBody = nextMethod === method ? body : null;
          return resolve(makeUpstreamRequest(redirectUrl, nextMethod, headers, nextBody, redirectsLeft - 1));
        }

        resolve({ statusCode: status, headers: upstreamRes.headers, body: Buffer.concat(chunks) });
      });
    });

    upstreamReq.on('error', reject);
    if (body && body.length > 0) upstreamReq.write(body);
    upstreamReq.end();
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (reqUrl.pathname !== '/proxy') {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const secret = req.headers['x-proxy-secret'];
  if (!secret || secret !== PROXY_SECRET) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  const targetUrlRaw = reqUrl.searchParams.get('url');
  if (!targetUrlRaw) {
    return sendJson(res, 400, { error: 'Missing url param' });
  }

  let target;
  try {
    target = new URL(targetUrlRaw);
  } catch {
    return sendJson(res, 400, { error: 'Invalid url param' });
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return sendJson(res, 403, { error: `Host not allowed: ${target.hostname}` });
  }

  const forwardHeaders = {};
  for (const h of FORWARD_HEADERS) {
    if (req.headers[h]) forwardHeaders[h] = req.headers[h];
  }
  // footystats.org의 검색(search.php)처럼 POST + form body가 필요한 요청도 있어서,
  // content-type은 별도로 챙겨서 그대로 넘겨준다.
  if (req.headers['content-type']) forwardHeaders['content-type'] = req.headers['content-type'];

  // 요청 바디를 먼저 다 읽은 다음에 업스트림으로 그대로 전달한다(GET은 바디가 없어서 0바이트로 끝남).
  const reqChunks = [];
  req.on('data', (c) => reqChunks.push(c));
  req.on('end', () => {
    const reqBody = Buffer.concat(reqChunks);
    if (reqBody.length > 0) forwardHeaders['content-length'] = String(reqBody.length);

    console.log(`[${new Date().toISOString()}] 프록시 요청: ${req.method} ${target.toString()} (바디 ${reqBody.length}바이트, content-type: ${forwardHeaders['content-type'] || '없음'})`);

    makeUpstreamRequest(target, req.method, forwardHeaders, reqBody)
      .then((upstreamRes) => {
        console.log(`[${new Date().toISOString()}]   ↳ 최종 응답: HTTP ${upstreamRes.statusCode}, ${upstreamRes.body.length}바이트`);
        const headers = {
          'Content-Type': upstreamRes.headers['content-type'] || 'application/octet-stream',
          'X-Upstream-Status': String(upstreamRes.statusCode),
        };
        // Set-Cookie가 여러 개일 수 있으니 배열 그대로 전달
        if (upstreamRes.headers['set-cookie']) {
          headers['Set-Cookie'] = upstreamRes.headers['set-cookie'];
        }
        res.writeHead(upstreamRes.statusCode, headers);
        res.end(upstreamRes.body);
      })
      .catch((err) => {
        console.error('업스트림 요청 실패:', err.message);
        sendJson(res, 502, { error: `Upstream fetch failed: ${err.message}` });
      });
  });
});

server.listen(PORT, () => {
  console.log(`🏠 홈 프록시 서버 시작됨: http://localhost:${PORT}/proxy?url=...`);
  console.log(`   PROXY_SECRET: ${PROXY_SECRET === 'CHANGE_ME_TO_A_RANDOM_STRING' ? '⚠️ 기본값 그대로입니다. 꼭 바꾸세요!' : '설정됨'}`);
  console.log(`   허용된 호스트: ${[...ALLOWED_HOSTS].join(', ')}`);
});