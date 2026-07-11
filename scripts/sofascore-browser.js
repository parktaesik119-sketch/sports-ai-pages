// scripts/sofascore-browser.js
// SofaScore API가 "challenge"(JS 챌린지)를 요구해서, 정적 HTTP 요청(직접 호출/Cloudflare
// Worker 경유 둘 다)으로는 뚫리지 않는 것을 확인함(2026-07 실사용 테스트).
//
// Playwright로 실제 Chromium을 띄워 sofascore.com 페이지를 연 뒤, 그 페이지의 JS 컨텍스트
// 안에서 fetch()를 실행하는 방식으로 우회한다. 브라우저가 쿠키/세션/챌린지를 스스로
// 처리해주므로, 예전에 sofascore-common.js에 있던 수동 쿠키 핸드셰이크 코드가 필요 없다.
//
// 스크립트 프로세스 하나당 브라우저 인스턴스도 하나만 띄우고, 모든 API 호출이 같은
// 페이지 컨텍스트를 재사용한다(경기 180건마다 브라우저를 새로 열면 너무 느려짐).

import { chromium } from 'playwright';

let browserPromise = null;
let pagePromise = null;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        // navigator.webdriver 등 "이건 자동화 브라우저다" 신호를 최대한 줄임.
        // 100% 은닉은 불가능하지만 기본 탐지는 회피 가능.
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browserPromise;
}

function getPage() {
  if (!pagePromise) {
    pagePromise = (async () => {
      const browser = await getBrowser();
      const context = await browser.newContext({
        userAgent: UA,
        viewport: { width: 1280, height: 800 },
        locale: 'ko-KR',
      });

      // navigator.webdriver = true로 찍히는 걸 숨기는 최소한의 스텔스 패치.
      // (playwright-extra + stealth 플러그인만큼 정교하진 않지만, 기본적인 자동화 탐지는 피한다)
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      const page = await context.newPage();
      console.log('🌐 [SofaScore] 브라우저로 홈페이지 로딩 중...');
      await page.goto('https://www.sofascore.com/', { waitUntil: 'networkidle', timeout: 30000 });
      console.log('✅ [SofaScore] 브라우저 세션 준비 완료');
      return page;
    })();
  }
  return pagePromise;
}

// 브라우저 페이지 컨텍스트 "안"에서 fetch()를 실행해서 JSON을 가져온다.
// 쿠키/세션/Referer/Origin 전부 브라우저가 자동으로 붙여주므로 별도 헤더 조작이 필요 없다.
export async function fetchJsonViaBrowser(url) {
  const page = await getPage();

  const result = await page.evaluate(async (targetUrl) => {
    try {
      const res = await fetch(targetUrl, { headers: { 'Accept': 'application/json' } });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      return { ok: false, status: 0, text: String(err && err.message || err) };
    }
  }, url);

  if (!result.ok) {
    throw new Error(`GET ${url} 실패: HTTP ${result.status} | 응답 일부: ${result.text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`GET ${url} 응답 JSON 파싱 실패: ${result.text.slice(0, 200)}`);
  }
}

// 스크립트 종료 전 반드시 호출해야 한다 — 안 부르면 브라우저 프로세스가 남아서
// GitHub Actions 스텝이 안 끝나고 계속 대기할 수 있음.
export async function closeSofascoreBrowser() {
  if (pagePromise) {
    try {
      const page = await pagePromise;
      await page.context().close();
    } catch (err) {
      console.error('⚠️ [SofaScore] 페이지 종료 중 오류:', err.message);
    }
  }
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch (err) {
      console.error('⚠️ [SofaScore] 브라우저 종료 중 오류:', err.message);
    }
  }
  pagePromise = null;
  browserPromise = null;
}