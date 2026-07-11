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

// footystats.org가 짧은 시간에 요청이 몰리면 429(속도 제한)로 막는 것을 실사용
// 테스트로 확인함 — 모든 요청 사이에 최소한의 간격을 둔다.
// (0.8초로 뒀을 때도 간헐적으로 빈 응답이 오는 사례가 있어 1.5초로 늘림 — 2026-07 확인)
const REQUEST_DELAY_MS = 1500;
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function proxyFetchOnce(targetUrl, { method = 'GET', body = null, headers = {} } = {}) {
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

async function proxyFetch(targetUrl, options = {}) {
  assertProxyConfigured();
  await delay(REQUEST_DELAY_MS);
  const text = await proxyFetchOnce(targetUrl, options);

  // ⚠️ HTTP 200인데 본문이 텅 빈 간헐적 케이스가 관찰됨(2026-07) — 명확한 에러는
  // 아니라서 위 에러 처리로는 안 걸러지지만, 실제로는 실패한 요청이다.
  // 한 번 더 기다렸다가 재시도해서 자동 복구를 시도한다.
  if (text.length === 0) {
    console.log(`   ⚠️ 빈 응답 감지, 재시도: ${targetUrl}`);
    await delay(REQUEST_DELAY_MS * 2);
    return proxyFetchOnce(targetUrl, options);
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

  // ⚠️ 진단용: 검색 결과가 0건이면, 실제로 응답이 어떻게 왔는지 로그로 남긴다.
  // (파싱 셀렉터가 틀렸는지, 프록시가 이상한 응답을 돌려줬는지, 진짜 검색 결과가
  // 없는 건지 다음 실행 로그에서 구분할 수 있게 함)
  if (results.length === 0) {
    console.log(`   🔎 [진단] "${query}" 검색 결과 0건 — 응답 길이 ${html.length}자, 앞부분: ${html.slice(0, 300).replace(/\s+/g, ' ')}`);
  }

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
  const VALID_POSITIONS = new Set(['GK', 'DF', 'MF', 'FW']);
  const players = [];
  const seen = new Set(); // profilePath 기준 중복 제거

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

    // ⚠️ 스쿼드 표(전체 선수 명단) 말고도 페이지 다른 곳(득점자 순위 등)에
    // 같은 클래스(a.semi-bold)의 선수 링크가 또 나와서 이름 뒤에 숫자가 붙은
    // 중복 항목("Stefan Mugoša  7" 등, position 없음)이 섞이는 걸 실사용 테스트로 확인함.
    // 포지션이 GK/DF/MF/FW 중 하나로 정확히 확인된 것만 스쿼드로 인정한다.
    if (!VALID_POSITIONS.has(position)) return;
    if (seen.has(href)) return; // 같은 선수가 여러 번 잡히는 것도 방지
    seen.add(href);

    if (name && href) {
      players.push({
        name,
        position,
        profilePath: href,
        photoUrl: country && slug ? `https://cdn.footystats.org/img/players/${country}-${slug}.png` : null,
      });
    }
  });

  // ⚠️ 진단용: 선수를 하나도 못 찾았으면, 파싱 셀렉터가 안 맞는 건지 이 클럽 페이지
  // 자체에 스쿼드 정보가 없는 건지 구분할 수 있게 페이지 제목/일부를 남긴다.
  if (players.length === 0) {
    const title = $('title').text().trim();
    const bodySnippet = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 200);
    console.log(`   🔎 [진단] 스쿼드 0명 — 페이지 제목: "${title}" | 본문 일부: ${bodySnippet}`);
  }

  return players;
}

// ─────────────────────────────────────────────
// 3. H2H 페이지: GET /{country-slug}/{team1}-vs-{team2}-h2h-stats
//    아그리게이트 요약 + 개별 경기 리스트(최대 수십 경기)
// ─────────────────────────────────────────────
// H2H 페이지를 딱 한 번만 가져온다(매치 목록과 라인업이 같은 페이지 안에 다 있어서
// 따로따로 요청할 필요가 없음 — 실사용 테스트로 확인).
export async function getH2hPage(countrySlug, team1Slug, team2Slug) {
  const url = `https://footystats.org/${countrySlug}/${stripClubIdSuffix(team1Slug)}-vs-${stripClubIdSuffix(team2Slug)}-h2h-stats`;
  try {
    const html = await getHtml(url);
    return cheerio.load(html);
  } catch (err) {
    // ⚠️ 진단용: 301 등으로 실패하면 실제로 어떤 URL을 시도했는지(특히 countrySlug 값)
    // 남겨서 다음 실행 로그에서 URL 조립 자체가 잘못된 건지 바로 확인 가능하게 한다.
    throw new Error(`${err.message} | 시도한 URL: ${url} (countrySlug="${countrySlug}")`);
  }
}

// $ = getH2hPage()가 반환한 cheerio 인스턴스
export function parseH2hMatches($, limit = 10) {
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

// 하위 호환용 - 예전처럼 한 번에 fetch + parse를 같이 하고 싶을 때.
// (라인업까지 같이 필요하면 getH2hPage() + parseH2hMatches()/parseMatchLineups()를
// 따로 써서 페이지를 한 번만 가져오는 쪽이 요청 수를 아낄 수 있음)
export async function getH2H(countrySlug, team1Slug, team2Slug, limit = 10) {
  const $ = await getH2hPage(countrySlug, team1Slug, team2Slug);
  return parseH2hMatches($, limit);
}

// ─────────────────────────────────────────────
// H2H 페이지 안에 있는 "Lineup Predictions & Injuries" 섹션 — 두 팀의 최근 사용
// 선발 11명(등번호/이름/세부포지션)을 뽑는다. ⚠️ "가장 최근에 사용된 라인업"
// 기준이지, 이번 경기 확정/공식 라인업이 아니다(footystats 페이지 자체 문구로 확인).
// $ = getH2hPage()가 반환한 cheerio 인스턴스
// ─────────────────────────────────────────────
export function parseMatchLineups($) {
  // "#Starting 11" 헤더가 팀당 하나씩(총 2개), 그 바로 뒤에 "#Substitutes" 헤더가 옴.
  // [팀1-Starting11, 팀1-Substitutes, 팀2-Starting11, 팀2-Substitutes] 순서.
  const headers = $('.club-blue-highlight').toArray();
  const startingHeaders = headers.filter(h => $(h).text().includes('Starting 11'));
  if (startingHeaders.length < 2) return null; // 라인업 섹션 자체가 없는 경기(하위 리그 등)

  const allRows = $('.row.cf.m0Auto').toArray();

  // cheerio에는 DOM의 compareDocumentPosition이 없어서, 전체 노드 배열에서의
  // 인덱스 순서로 "헤더 A와 B 사이에 있는 행"을 판단한다.
  const allNodesInOrder = $('*').toArray();
  const indexOf = (el) => allNodesInOrder.indexOf(el);

  function rowsBetween(startEl, endEl) {
    const startIdx = indexOf(startEl);
    const endIdx = endEl ? indexOf(endEl) : Infinity;
    return allRows.filter(r => {
      const idx = indexOf(r);
      return idx > startIdx && idx < endIdx;
    });
  }

  function extractPlayers(rows) {
    const players = [];
    for (const r of rows) {
      const ps = $(r).children('p').toArray();
      if (ps.length < 3) continue;
      const a = $(ps[1]).find('a').first();
      const href = a.attr('href');
      const name = a.text().trim();
      const position = $(ps[2]).text().trim();
      const number = $(ps[0]).text().trim();
      if (!name || !href) continue;

      const parts = href.split('/').filter(Boolean); // ['players', country, slug]
      const country = parts[1];
      const slug = parts[2];

      players.push({
        number: number || null,
        name,
        position: position || null,
        profilePath: href,
        photoUrl: country && slug ? `https://cdn.footystats.org/img/players/${country}-${slug}.png` : null,
      });
    }
    return players;
  }

  function nextHeaderAfter(headerEl) {
    const pos = headers.indexOf(headerEl);
    return headers[pos + 1] || null;
  }

  const homeStarting = extractPlayers(rowsBetween(startingHeaders[0], nextHeaderAfter(startingHeaders[0])));
  const awayStarting = extractPlayers(rowsBetween(startingHeaders[1], nextHeaderAfter(startingHeaders[1])));

  if (homeStarting.length === 0 && awayStarting.length === 0) return null;

  return { home: homeStarting, away: awayStarting };
}

// 라인업(parseMatchLineups 결과의 home 또는 away)을 _slug_.astro가 기대하는
// "{이름} ({포지션})|{사진URL}" 문자열 배열로 변환. (kbo-lineup-update.js 등과 동일 포맷)
export function formatLineupForDisplay(players) {
  if (!players || players.length === 0) return [];
  return players.map(p => {
    const base = `${p.name} (${p.position || 'MF'})`;
    return p.photoUrl ? `${base}|${p.photoUrl}` : base;
  });
}

// clubPath("/clubs/galway-united-fc-2052")에서 country/team 슬러그를 뽑아내는 헬퍼.
// H2H URL은 country-slug가 필요한데 이건 클럽 페이지의 국가 링크에서 가져와야 한다
// (clubPath 자체엔 국가 정보가 없음).
export function extractTeamSlugFromClubPath(clubPath) {
  // /clubs/galway-united-fc-2052 → galway-united-fc-2052
  const m = clubPath.match(/\/clubs\/(.+)$/);
  return m ? m[1] : null;
}

// ⚠️ H2H URL(/{country}/{team1}-vs-{team2}-h2h-stats)에 쓰이는 팀 슬러그는
// 클럽 페이지 경로 끝에 붙는 숫자 ID가 빠진 형태다.
// 예: 클럽 경로 slug "galway-united-fc-2052" → H2H에는 "galway-united-fc"만 사용.
// (실사용 테스트로 확인: 숫자 ID를 안 떼면 301 리다이렉트가 남 — 원인 특정 완료)
export function stripClubIdSuffix(slug) {
  if (!slug) return slug;
  return slug.replace(/-\d+$/, '');
}

// $ = getClubPage()가 반환한 cheerio 인스턴스에서 국가 슬러그 추출.
// 페이지 상단 브레드크럼(.breadcrumb)의 첫 번째 링크가 이 클럽의 국가/리그 최상위 경로다.
// (실사용 테스트로 확인: .breadcrumb 안의 링크 = ["/republic-of-ireland", "/clubs/galway-united-fc-2052"])
export function parseCountrySlug($) {
  const href = $('.breadcrumb a').first().attr('href'); // 예: /republic-of-ireland
  if (!href) return null;
  return href.split('/').filter(Boolean)[0] || null;
}

// ─────────────────────────────────────────────
// _slug_.astro가 실제로 렌더링하는 정확한 스키마로 변환.
// (직접 _slug_.astro 소스를 확인해서 맞춘 스키마 — 2026-07-11 확인)
//
// h2h:               { date, home, away, score, link? }              (result 없음)
// homeRecent/awayRecent: { date, home, away, score, result, link? }  (result: 🟢승/🔴패/🟡무)
//
// footystats matches({date:"2026-07-03", home, away, homeScore, awayScore})를
// 위 스키마로 변환한다. link는 footystats 매치엔 사이트 내부 글이 없으므로 항상 생략.
// ─────────────────────────────────────────────

// "2026-07-03" → "26.07.03" (기존 AI가 쓰던 날짜 표기와 동일하게 맞춤)
function toShortDate(isoDate) {
  const parts = (isoDate || '').split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
}

function computeResultEmoji(perspectiveIsHome, homeScore, awayScore) {
  const mine = perspectiveIsHome ? homeScore : awayScore;
  const opp  = perspectiveIsHome ? awayScore : homeScore;
  if (mine > opp) return '🟢승';
  if (mine < opp) return '🔴패';
  return '🟡무';
}

// h2h 필드용 변환 (result 없음)
export function toH2hDisplayFormat(matches) {
  return matches.map(m => ({
    date: toShortDate(m.date),
    home: m.home,
    away: m.away,
    score: `${m.homeScore}-${m.awayScore}`,
  }));
}

// homeRecent/awayRecent 필드용 변환. perspectiveNameKo는 "이 목록이 누구 기준인지"
// (homeRecent면 홈팀의 한글명, awayRecent면 원정팀의 한글명) — m.home과 문자열이
// 일치하면 그 경기에서 이 팀이 홈이었다고 보고 result를 계산한다.
export function toRecentDisplayFormat(matches, perspectiveNameKo) {
  return matches.map(m => {
    const perspectiveIsHome = m.home === perspectiveNameKo;
    return {
      date: toShortDate(m.date),
      home: m.home,
      away: m.away,
      score: `${m.homeScore}-${m.awayScore}`,
      result: computeResultEmoji(perspectiveIsHome, m.homeScore, m.awayScore),
    };
  });
}