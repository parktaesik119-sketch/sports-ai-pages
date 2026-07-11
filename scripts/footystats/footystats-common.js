// scripts/footystats/footystats-common.js
// footystats.org는 API가 없고 서버사이드 렌더링된 HTML을 그대로 내려주는 사이트다
// (2026-07 실사용 브라우저 조사로 확인). GitHub Actions IP는 Cloudflare가 차단하지만
// 집 IP(HOME_PROXY_URL 경유)로는 챌린지 없이 그대로 통과되는 것도 확인함.
//
// ⚠️ 전제조건: 이 파일의 모든 함수는 HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가
// 반드시 있어야 동작한다 (footystats.org는 GitHub Actions IP에서 직접 호출하면 403).
//
// 필요 패키지: npm install cheerio

import * as cheerio from 'cheerio';

const HOME_PROXY_URL = (process.env.HOME_PROXY_URL || '').trim();
const HOME_PROXY_SECRET = (process.env.HOME_PROXY_SECRET || '').trim();

function assertProxyConfigured() {
  if (!HOME_PROXY_URL || !HOME_PROXY_SECRET) {
    throw new Error('HOME_PROXY_URL / HOME_PROXY_SECRET 환경변수가 필요합니다 (footystats.org는 집 IP 경유 필수)');
  }
}

async function proxyFetch(targetUrl, { method = 'GET', body = null, headers = {} } = {}) {
  assertProxyConfigured();
  const proxiedUrl = `${HOME_PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(proxiedUrl, {
    method,
    headers: { 'X-Proxy-Secret': HOME_PROXY_SECRET, ...headers },
    body,
  });
  const upstreamStatus = res.headers.get('x-upstream-status');
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`프록시 요청 실패: HTTP ${res.status} | ${text.slice(0, 200)}`);
  }
  if (upstreamStatus && upstreamStatus !== '200') {
    throw new Error(`footystats.org 응답 실패: HTTP ${upstreamStatus} | ${text.slice(0, 200)}`);
  }
  return text;
}

async function getHtml(url) {
  return proxyFetch(url, { method: 'GET' });
}

// ─────────────────────────────────────────────
// 1. 팀 검색: POST /search.php (body: searchString={query})
// ─────────────────────────────────────────────
export async function searchClub(query) {
  const html = await proxyFetch('https://footystats.org/search.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `searchString=${encodeURIComponent(query)}`,
  });

  const $ = cheerio.load(html);
  const results = [];
  $('li > a.cf').each((_, el) => {
    const href = $(el).attr('href'); // 예: /clubs/manchester-united-fc-149
    const name = $(el).find('.name').text().trim();
    if (href && href.startsWith('/clubs/')) {
      results.push({ name, path: href });
    }
  });
  return results;
}

// ─────────────────────────────────────────────
// 2. 클럽 페이지: 최근 경기(완료분) + 스쿼드(선수+포지션+사진)
//    GET /clubs/{slug} (한글(/kr/) 아님 — 영문 페이지 기준으로 파싱해야 팀명이
//    team_name_map.js와 매칭하기 쉽다)
// ─────────────────────────────────────────────
export async function getClubPage(clubPath) {
  const url = clubPath.startsWith('http') ? clubPath : `https://footystats.org${clubPath}`;
  const html = await getHtml(url);
  return cheerio.load(html);
}

// $ = getClubPage()가 반환한 cheerio 인스턴스
export function parseClubRecentMatches($, limit = 10) {
  const matches = [];
  $('li.matchHistoryEvent').each((_, el) => {
    const li = $(el);
    // 클래스에 'incomplete'가 있으면 아직 안 끝난(예정) 경기라 제외
    if ((li.attr('class') || '').includes('incomplete')) return;

    const home = li.find('.homeTeamInfo p').first().text().trim();
    const away = li.find('.awayTeamInfo p').first().text().trim();
    const scoreText = li.find('.scoreline span').first().text().trim(); // "3 - 0"
    const isoDate = li.find("meta[itemprop='startDate']").attr('content'); // 2026-07-03T18:45:00+00:00

    const scoreParts = scoreText.split('-').map(s => s.trim());
    const homeScore = scoreParts[0] !== undefined ? parseInt(scoreParts[0], 10) : null;
    const awayScore = scoreParts[1] !== undefined ? parseInt(scoreParts[1], 10) : null;

    if (!home || !away || Number.isNaN(homeScore) || Number.isNaN(awayScore)) return;

    matches.push({
      date: isoDate ? isoDate.slice(0, 10) : null,
      home,
      away,
      homeScore,
      awayScore,
    });
  });

  // 최신순 정렬(날짜 문자열 비교로 충분 - ISO 형식) 후 상위 N개만
  return matches
    .filter(m => m.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

// $ = getClubPage()가 반환한 cheerio 인스턴스
export function parseClubSquad($) {
  const players = [];
  $("a.semi-bold[href^='/players/']").each((_, el) => {
    const a = $(el);
    const href = a.attr('href'); // /players/{country}/{name-slug}
    const name = a.text().trim();
    const parts = href.split('/').filter(Boolean); // ['players', country, slug]
    const country = parts[1];
    const slug = parts[2];

    // 같은 행(div.w94.rw100.cf.m0Auto) 안의 두 번째 <p>가 포지션(GK/DF/MF/FW)
    const row = a.closest('p').parent(); // <p class="col-lg-6 ellipses">의 부모 div
    const position = row.find('p').eq(1).text().trim();

    if (name && href) {
      players.push({
        name,
        position: position || null,
        profilePath: href,
        photoUrl: country && slug ? `https://cdn.footystats.org/img/players/${country}-${slug}.png` : null,
      });
    }
  });
  return players;
}

// ─────────────────────────────────────────────
// 3. H2H 페이지: GET /{country-slug}/{team1}-vs-{team2}-h2h-stats
//    아그리게이트 요약 + 개별 경기 리스트(최대 수십 경기)
// ─────────────────────────────────────────────
export async function getH2H(countrySlug, team1Slug, team2Slug, limit = 10) {
  const url = `https://footystats.org/${countrySlug}/${team1Slug}-vs-${team2Slug}-h2h-stats`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);

  const matches = [];
  $('a.fixture.changeH2HDataButton_neo').each((_, el) => {
    const a = $(el);
    const isoDate = a.find('time').attr('datetime');
    const teamDivs = a.find('.team');
    if (teamDivs.length < 2) return;

    function parseTeamDiv(div) {
      const span = div.find('span').first();
      const scoreText = span.text().trim();
      const score = scoreText === '' ? null : parseInt(scoreText, 10);
      const name = div.clone().children('span').remove().end().text().trim();
      return { name, score: Number.isNaN(score) ? null : score };
    }

    const t1 = parseTeamDiv(teamDivs.eq(0));
    const t2 = parseTeamDiv(teamDivs.eq(1));

    if (t1.score === null || t2.score === null) return; // 아직 안 열린(예정) 경기는 제외

    matches.push({
      date: isoDate ? isoDate.slice(0, 10) : null,
      home: t1.name,
      away: t2.name,
      homeScore: t1.score,
      awayScore: t2.score,
    });
  });

  return matches
    .filter(m => m.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

// clubPath("/clubs/galway-united-fc-2052")에서 country/team 슬러그를 뽑아내는 헬퍼.
// H2H URL은 country-slug가 필요한데 이건 클럽 페이지의 국가 링크에서 가져와야 한다
// (clubPath 자체엔 국가 정보가 없음).
export function extractTeamSlugFromClubPath(clubPath) {
  // /clubs/galway-united-fc-2052 → galway-united-fc-2052
  const m = clubPath.match(/\/clubs\/(.+)$/);
  return m ? m[1] : null;
}

// $ = getClubPage()가 반환한 cheerio 인스턴스에서 국가 슬러그 추출.
// 페이지 상단 브레드크럼(.breadcrumb)의 첫 번째 링크가 이 클럽의 국가/리그 최상위 경로다.
// (실사용 테스트로 확인: .breadcrumb 안의 링크 = ["/republic-of-ireland", "/clubs/galway-united-fc-2052"])
export function parseCountrySlug($) {
  const href = $('.breadcrumb a').first().attr('href'); // 예: /republic-of-ireland
  if (!href) return null;
  return href.split('/').filter(Boolean)[0] || null;
}